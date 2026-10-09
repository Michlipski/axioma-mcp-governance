/**
 * Axioma MCP Gateway Server
 *
 * Description: Zero-Trust MCP Gateway proxy on port 3001 intercepting and auditing agent calls before reaching true MCP server on port 3000.
 *
 * Implements the Zero-Trust MCP Gateway layer for the Axioma architecture.
 * Intercepts, logs, and audits all JSON-RPC communication between autonomous
 * LLM agents and the true MCP server on port 3000.
 *
 * Architecture Principles:
 * 1. Zero-Trust Interception: Agents must never reach state machines unmonitored.
 * 2. Strict Observer / Non-Mutating Proxy: Payloads are forwarded byte-for-byte.
 * 3. Immutable Audit Trail: Logs initial INTERCEPTED state to PostgreSQL,
 *    records the target MCP server's verdict (APPROVED / REJECTED), and returns
 *    the unmodified response to the client.
 */

import http from 'node:http';
import crypto from 'node:crypto';
import { URL } from 'node:url';
import { eq } from 'drizzle-orm';
import { db as defaultDb, schema } from '../db';

export type AuditStatus = 'INTERCEPTED' | 'APPROVED' | 'REJECTED';

export interface ForwardResult {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

export interface GatewayConfig {
  port: number;
  targetMcpUrl: string;
  db?: typeof defaultDb;
  forwarder?: (params: {
    method?: string;
    url: string;
    headers: http.OutgoingHttpHeaders;
    body: Buffer;
  }) => Promise<ForwardResult>;
}

export interface ExtractedMetadata {
  agentId: string;
  sessionId: string;
  toolName: string;
}

/**
 * Extracts audit metadata from request headers and JSON-RPC body
 * without mutating the payload.
 */
export function extractMetadata(
  headers: http.IncomingHttpHeaders,
  body: any
): ExtractedMetadata {
  const agentId =
    (headers['x-agent-id'] as string) ||
    (headers['agent-id'] as string) ||
    body?.params?._meta?.agentId ||
    body?.params?.agentId ||
    'agent-axioma-subagent';

  const sessionId =
    (headers['x-session-id'] as string) ||
    (headers['session-id'] as string) ||
    body?.params?._meta?.sessionId ||
    body?.params?.sessionId ||
    `session-${crypto.randomUUID()}`;

  // For MCP tools/call, tool_name is params.name (e.g. 'propose_resolver', 'introspect_state')
  // Otherwise falls back to method (e.g. 'initialize', 'resources/read') or 'unknown'
  const toolName =
    body?.params?.name ||
    body?.method ||
    'unknown';

  return { agentId, sessionId, toolName };
}

/**
 * Evaluates the verdict of the true MCP server response.
 * Inspects JSON-RPC errors, tool call errors, and XState proposal outcomes.
 */
export function evaluateVerdict(statusCode: number, jsonRpcResponse: any): AuditStatus {
  if (statusCode >= 400) {
    return 'REJECTED';
  }
  if (!jsonRpcResponse) {
    return 'REJECTED';
  }
  if (jsonRpcResponse.error) {
    return 'REJECTED';
  }

  const result = jsonRpcResponse.result;
  if (!result) {
    return 'APPROVED';
  }

  // Explicit MCP tool execution error flag
  if (result.isError === true) {
    return 'REJECTED';
  }

  // Check structured content responses from Axioma MCP tools (e.g. propose_resolver)
  if (Array.isArray(result.content)) {
    for (const item of result.content) {
      if (item.type === 'text' && typeof item.text === 'string') {
        try {
          const parsed = JSON.parse(item.text);
          if (parsed.status === 'REJECTED') {
            return 'REJECTED';
          }
          if (parsed.status === 'APPROVED') {
            return 'APPROVED';
          }
        } catch {
          if (
            item.text.includes('"status": "REJECTED"') ||
            item.text.includes('Transition violation') ||
            item.text.includes('rejected due to')
          ) {
            return 'REJECTED';
          }
        }
      }
    }
  }

  if (result.status === 'REJECTED') {
    return 'REJECTED';
  }

  return 'APPROVED';
}

/**
 * Creates the HTTP Gateway Server instance.
 */
/**
 * Dispatches and audits incoming MCP HTTP JSON-RPC requests.
 */
export function handleGatewayRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config?: Partial<GatewayConfig>
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    res.once('finish', () => resolve());
    res.once('close', () => resolve());

    const port = config?.port ?? Number(process.env.GATEWAY_PORT || 3001);
    const targetMcpUrl = config?.targetMcpUrl ?? (process.env.TARGET_MCP_URL || 'http://localhost:3000');
    const db = config?.db ?? defaultDb;

    // Enable CORS for dashboard and local inspection
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-agent-id, x-session-id, agent-id, session-id');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Health and telemetry status endpoint
    if (req.method === 'GET' && (req.url === '/health' || req.url === '/gateway/status')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'UP',
          gateway: 'Axioma Zero-Trust MCP Proxy',
          listeningPort: port,
          targetMcpUrl,
          timestamp: new Date().toISOString(),
        })
      );
      return;
    }

    // Accumulate raw request body
    const bodyChunks: Buffer[] = [];
    req.on('data', (chunk) => bodyChunks.push(chunk));

    req.on('end', async () => {
      const rawBody = Buffer.concat(bodyChunks);
      const rawBodyString = rawBody.toString('utf-8');

      // Attempt parsing JSON-RPC payload
      let parsedPayload: any = null;
      try {
        if (rawBodyString.trim().length > 0) {
          parsedPayload = JSON.parse(rawBodyString);
        }
      } catch (err) {
        // Invalid JSON received
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: {
              code: -32700,
              message: 'Parse error: Invalid JSON was received by MCP Gateway',
            },
          })
        );
        return;
      }

      // Extract metadata for auditing without mutating payload
      const metadata = extractMetadata(req.headers, parsedPayload);
      const logId = crypto.randomUUID();

      // Step 1: Write initial INTERCEPTED audit log to PostgreSQL
      try {
        await db.insert(schema.agentAuditLogs).values({
          id: logId,
          agentId: metadata.agentId,
          sessionId: metadata.sessionId,
          toolName: metadata.toolName,
          payload: parsedPayload ?? { raw: rawBodyString },
          status: 'INTERCEPTED',
          createdAt: new Date(),
        });
      } catch (dbErr: any) {
        process.stderr.write(
          `[MCP Gateway Warning] Initial audit log insert failed: ${dbErr?.message || String(dbErr)}\n`
        );
      }

      // Step 2: Forward unmutated payload to true MCP server on port 3000
      const targetUrl = new URL(req.url || '/', targetMcpUrl);
      const forwardHeaders: http.OutgoingHttpHeaders = {
        ...req.headers,
        host: targetUrl.host,
        'content-length': Buffer.byteLength(rawBody),
      };

      const handleForwardSuccess = async (
        statusCode: number,
        headers: http.IncomingHttpHeaders,
        rawResponse: Buffer
      ) => {
        const responseString = rawResponse.toString('utf-8');
        let parsedResponseJson: any = null;
        try {
          if (responseString.trim().length > 0) {
            parsedResponseJson = JSON.parse(responseString);
          }
        } catch {
          parsedResponseJson = { raw: responseString };
        }

        // Step 3: Evaluate state machine / MCP verdict
        const verdict: AuditStatus = evaluateVerdict(statusCode || 200, parsedResponseJson);

        // Step 4: Update PostgreSQL audit log with final status & response
        try {
          await db
            .update(schema.agentAuditLogs)
            .set({
              status: verdict,
              response: parsedResponseJson,
            })
            .where(eq(schema.agentAuditLogs.id, logId));
        } catch (dbErr: any) {
          process.stderr.write(
            `[MCP Gateway Warning] Audit log verdict update failed: ${dbErr?.message || String(dbErr)}\n`
          );
        }

        // Step 5: Return exact target response to client unmutated
        const targetHeaders = { ...headers };
        delete targetHeaders['transfer-encoding'];
        targetHeaders['content-length'] = String(rawResponse.length);

        res.writeHead(statusCode || 200, targetHeaders);
        res.end(rawResponse);
      };

      const handleForwardError = async (fwdErr: any) => {
        process.stderr.write(
          `[MCP Gateway Error] Failed to proxy to true MCP server at ${targetMcpUrl}: ${fwdErr.message}\n`
        );

        try {
          await db
            .update(schema.agentAuditLogs)
            .set({
              status: 'REJECTED',
              response: {
                error: `Gateway upstream error: ${fwdErr.message}`,
                targetMcpUrl,
              },
            })
            .where(eq(schema.agentAuditLogs.id, logId));
        } catch {
          // Ignore secondary DB error
        }

        const errorResponse = {
          jsonrpc: '2.0',
          id: parsedPayload?.id ?? null,
          error: {
            code: -32000,
            message: `MCP Gateway upstream connection error: unable to reach true MCP server at ${targetMcpUrl} (${fwdErr.message})`,
          },
        };

        const jsonBytes = Buffer.from(JSON.stringify(errorResponse, null, 2));
        res.writeHead(502, {
          'Content-Type': 'application/json',
          'Content-Length': String(jsonBytes.length),
        });
        res.end(jsonBytes);
      };

      if (config?.forwarder) {
        try {
          const result = await config.forwarder({
            method: req.method,
            url: targetUrl.href,
            headers: forwardHeaders,
            body: rawBody,
          });
          await handleForwardSuccess(result.statusCode, result.headers, result.body);
        } catch (err: any) {
          await handleForwardError(err);
        }
        return;
      }

      const forwardReq = http.request(
        {
          hostname: targetUrl.hostname,
          port: targetUrl.port || 3000,
          path: targetUrl.pathname + targetUrl.search,
          method: req.method,
          headers: forwardHeaders,
        },
        (targetRes) => {
          const responseChunks: Buffer[] = [];
          targetRes.on('data', (chunk) => responseChunks.push(chunk));
          targetRes.on('end', async () => {
            await handleForwardSuccess(
              targetRes.statusCode || 200,
              targetRes.headers,
              Buffer.concat(responseChunks)
            );
          });
        }
      );

      forwardReq.on('error', handleForwardError);
      forwardReq.write(rawBody);
      forwardReq.end();
    });
  });
}

/**
 * Creates the HTTP Gateway Server instance.
 */
export function createGatewayServer(config?: Partial<GatewayConfig>): http.Server {
  return http.createServer((req, res) => {
    handleGatewayRequest(req, res, config).catch((err) => {
      process.stderr.write(`[MCP Gateway Fatal] Unhandled error in request: ${err.message}\n`);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal gateway proxy error' }));
      }
    });
  });
}

/**
 * Starts the MCP Gateway server on port 3001.
 */
export function startGatewayServer(port: number = Number(process.env.GATEWAY_PORT || 3001)) {
  const server = createGatewayServer({ port });
  server.listen(port, () => {
    process.stdout.write(
      `[Axioma MCP Gateway] Proxy server running on http://localhost:${port}\n` +
      `[Axioma MCP Gateway] Forwarding telemetry & requests to true MCP server on http://localhost:3000\n` +
      `[Axioma MCP Gateway] PostgreSQL audit logging active for table: agent_audit_logs\n`
    );
  });
  return server;
}

// Automatically start if executed as script
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('src/gateway/server.ts') ||
    process.argv[1].endsWith('dist/gateway/server.js') ||
    process.argv[1].includes('gateway/server'));

if (isDirectRun) {
  startGatewayServer();
}
