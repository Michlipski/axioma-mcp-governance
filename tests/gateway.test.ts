import { test, describe } from 'node:test';
import assert from 'node:assert';
import { Readable, Writable } from 'node:stream';
import {
  evaluateVerdict,
  extractMetadata,
  handleGatewayRequest,
  GatewayConfig,
} from '../src/gateway/server';

// Helper to create mock IncomingMessage and ServerResponse streams for in-memory testing
function createMockHttpTransaction(params: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: any;
}) {
  const method = params.method || 'POST';
  const url = params.url || '/';
  const headers = params.headers || { 'content-type': 'application/json' };
  const rawBody = params.body ? Buffer.from(JSON.stringify(params.body)) : Buffer.alloc(0);

  const req = new Readable({
    read() {
      if (rawBody.length > 0) {
        this.push(rawBody);
      }
      this.push(null);
    },
  }) as any;

  req.method = method;
  req.url = url;
  req.headers = headers;

  const responseChunks: Buffer[] = [];
  let responseStatusCode = 200;
  let responseHeaders: Record<string, any> = {};

  const res = new Writable({
    write(chunk, _encoding, callback) {
      responseChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      callback();
    },
  }) as any;

  const originalEnd = res.end.bind(res);
  res.end = (chunk?: any, encoding?: any, cb?: any) => {
    if (chunk && typeof chunk !== 'function') {
      responseChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return originalEnd(typeof chunk === 'function' ? chunk : undefined, encoding, cb);
  };

  res.setHeader = (k: string, v: any) => {
    responseHeaders[k.toLowerCase()] = v;
  };
  res.writeHead = (code: number, headers?: Record<string, any>) => {
    responseStatusCode = code;
    if (headers) {
      Object.assign(responseHeaders, headers);
    }
  };

  const getResponse = () => {
    const raw = Buffer.concat(responseChunks).toString('utf-8');
    let json: any = null;
    try {
      json = JSON.parse(raw);
    } catch {
      json = raw;
    }
    return {
      statusCode: responseStatusCode,
      headers: responseHeaders,
      body: json,
      rawBody: raw,
    };
  };

  return { req, res, getResponse };
}

describe('Axioma MCP Gateway - Zero-Trust JSON-RPC Proxy & Telemetry', () => {
  // In-memory mock audit database for unit testing proxy telemetry
  const auditLogStore: any[] = [];
  const mockDb: any = {
    insert: () => ({
      values: async (entry: any) => {
        auditLogStore.push({ ...entry });
        return [entry];
      },
    }),
    update: () => ({
      set: (updates: any) => ({
        where: async () => {
          const last = auditLogStore[auditLogStore.length - 1];
          if (last) {
            Object.assign(last, updates);
          }
        },
      }),
    }),
  };

  test('extractMetadata extracts agent, session, and tool name without payload mutation', () => {
    const payload = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'propose_resolver',
        arguments: { event: 'SUBMIT_PAYMENT' },
      },
    };

    const headers = {
      'x-agent-id': 'subagent-governance-007',
      'x-session-id': 'session-xyz-99',
    };

    const meta = extractMetadata(headers, payload);
    assert.strictEqual(meta.agentId, 'subagent-governance-007');
    assert.strictEqual(meta.sessionId, 'session-xyz-99');
    assert.strictEqual(meta.toolName, 'propose_resolver');
  });

  test('evaluateVerdict correctly classifies APPROVED and REJECTED responses', () => {
    const approvedResponse = {
      jsonrpc: '2.0',
      id: 1,
      result: {
        isError: false,
        content: [{ type: 'text', text: JSON.stringify({ status: 'APPROVED' }) }],
      },
    };
    assert.strictEqual(evaluateVerdict(200, approvedResponse), 'APPROVED');

    const rejectedResponse = {
      jsonrpc: '2.0',
      id: 2,
      result: {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify({ status: 'REJECTED' }) }],
      },
    };
    assert.strictEqual(evaluateVerdict(200, rejectedResponse), 'REJECTED');

    const errorResponse = {
      jsonrpc: '2.0',
      id: 3,
      error: { code: -32600, message: 'Invalid Request' },
    };
    assert.strictEqual(evaluateVerdict(200, errorResponse), 'REJECTED');

    assert.strictEqual(evaluateVerdict(500, null), 'REJECTED');
  });

  test('Gateway intercepts APPROVED proposal, writes INTERCEPTED then APPROVED, returns unmutated result', async () => {
    auditLogStore.length = 0;

    const requestPayload = {
      jsonrpc: '2.0',
      id: 'req-approved-1',
      method: 'tools/call',
      params: {
        name: 'propose_resolver',
        arguments: {
          mutationName: 'submitPayment',
          sourceState: 'pending_payment',
          event: 'SUBMIT_PAYMENT',
          payload: { idempotencyKey: 'idem_key_1', amountCents: 5000 },
        },
      },
    };

    const expectedUpstreamResponse = {
      jsonrpc: '2.0',
      id: 'req-approved-1',
      result: {
        isError: false,
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'APPROVED',
              sourceState: 'pending_payment',
              targetState: 'payment_processing',
              feedback: 'Proposal successfully validated!',
            }),
          },
        ],
      },
    };

    let forwardedPayload: any = null;
    const config: Partial<GatewayConfig> = {
      port: 3001,
      targetMcpUrl: 'http://localhost:3000',
      db: mockDb,
      forwarder: async (params) => {
        forwardedPayload = JSON.parse(params.body.toString('utf-8'));
        return {
          statusCode: 200,
          headers: { 'content-type': 'application/json' },
          body: Buffer.from(JSON.stringify(expectedUpstreamResponse)),
        };
      },
    };

    const { req, res, getResponse } = createMockHttpTransaction({
      headers: {
        'content-type': 'application/json',
        'x-agent-id': 'agent-test-approved',
        'x-session-id': 'session-test-approved',
      },
      body: requestPayload,
    });

    await handleGatewayRequest(req, res, config);
    const clientResponse = getResponse();

    // Verify client received exact upstream response
    assert.strictEqual(clientResponse.statusCode, 200);
    assert.deepStrictEqual(clientResponse.body, expectedUpstreamResponse);

    // Verify target received strictly unmutated payload
    assert.deepStrictEqual(forwardedPayload, requestPayload);

    // Verify audit log captured lifecycle (INTERCEPTED -> APPROVED)
    assert.strictEqual(auditLogStore.length, 1);
    const log = auditLogStore[0];
    assert.strictEqual(log.agentId, 'agent-test-approved');
    assert.strictEqual(log.sessionId, 'session-test-approved');
    assert.strictEqual(log.toolName, 'propose_resolver');
    assert.strictEqual(log.status, 'APPROVED');
    assert.deepStrictEqual(log.payload, requestPayload);
  });

  test('Gateway intercepts REJECTED proposal, updates status to REJECTED, preserves mathematical verdict', async () => {
    auditLogStore.length = 0;

    const requestPayload = {
      jsonrpc: '2.0',
      id: 'req-rejected-1',
      method: 'tools/call',
      params: {
        name: 'propose_resolver',
        arguments: {
          mutationName: 'submitPayment',
          sourceState: 'empty_cart',
          event: 'SUBMIT_PAYMENT',
        },
      },
    };

    const expectedUpstreamResponse = {
      jsonrpc: '2.0',
      id: 'req-rejected-1',
      result: {
        isError: true,
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'REJECTED',
              sourceState: 'empty_cart',
              violations: ['ILLEGAL_STATE_TRANSITION'],
              feedback: 'SUBMIT_PAYMENT is mathematically impossible in empty_cart',
            }),
          },
        ],
      },
    };

    const config: Partial<GatewayConfig> = {
      port: 3001,
      targetMcpUrl: 'http://localhost:3000',
      db: mockDb,
      forwarder: async () => {
        return {
          statusCode: 200,
          headers: { 'content-type': 'application/json' },
          body: Buffer.from(JSON.stringify(expectedUpstreamResponse)),
        };
      },
    };

    const { req, res, getResponse } = createMockHttpTransaction({
      headers: {
        'content-type': 'application/json',
        'x-agent-id': 'agent-rogue-bypass',
        'x-session-id': 'session-bypass-session',
      },
      body: requestPayload,
    });

    await handleGatewayRequest(req, res, config);
    const clientResponse = getResponse();

    assert.strictEqual(clientResponse.statusCode, 200);
    assert.deepStrictEqual(clientResponse.body, expectedUpstreamResponse);

    // Verify telemetry recorded violation
    assert.strictEqual(auditLogStore.length, 1);
    const log = auditLogStore[0];
    assert.strictEqual(log.agentId, 'agent-rogue-bypass');
    assert.strictEqual(log.status, 'REJECTED');
  });

  test('Gateway returns 502 with JSON-RPC error when target MCP server is unreachable', async () => {
    auditLogStore.length = 0;

    const config: Partial<GatewayConfig> = {
      port: 3001,
      targetMcpUrl: 'http://localhost:3000',
      db: mockDb,
      forwarder: async () => {
        throw new Error('ECONNREFUSED: connection refused to port 3000');
      },
    };

    const { req, res, getResponse } = createMockHttpTransaction({
      headers: { 'content-type': 'application/json' },
      body: { jsonrpc: '2.0', id: 99, method: 'tools/call' },
    });

    await handleGatewayRequest(req, res, config);
    const clientResponse = getResponse();

    assert.strictEqual(clientResponse.statusCode, 502);
    assert.strictEqual(clientResponse.body.jsonrpc, '2.0');
    assert.strictEqual(clientResponse.body.id, 99);
    assert.ok(clientResponse.body.error.message.includes('unable to reach true MCP server'));

    // Status in DB recorded as REJECTED due to upstream failure
    assert.strictEqual(auditLogStore.length, 1);
    assert.strictEqual(auditLogStore[0].status, 'REJECTED');
  });

  test('Gateway exposes health and telemetry inspection endpoint on GET /health', async () => {
    const { req, res, getResponse } = createMockHttpTransaction({
      method: 'GET',
      url: '/health',
    });

    await handleGatewayRequest(req, res, { port: 3001 });
    const response = getResponse();

    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(response.body.status, 'UP');
    assert.strictEqual(response.body.listeningPort, 3001);
  });
});
