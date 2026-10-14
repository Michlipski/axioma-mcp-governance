import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { db, schema } from '@/db';
import { eq } from 'drizzle-orm';
import {
  extractMetadata,
  evaluateVerdict,
  executeInternalMcpCall,
  sanitizeForJsonb,
} from '@/gateway/server';
import { recordInMemoryAuditLog } from '@/db/memoryStore';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, x-agent-id, x-session-id, agent-id, session-id, x-domain, domain',
};

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}

export async function GET() {
  return NextResponse.json(
    {
      status: 'UP',
      gateway: 'Axioma Zero-Trust MCP Gateway (Serverless)',
      architecture: 'XState v5 + GraphQL AST Governors',
      listeningRoute: '/axioma/api/gateway',
      timestamp: new Date().toISOString(),
    },
    { headers: corsHeaders }
  );
}

export async function POST(request: NextRequest) {
  let body: any = null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: 'Parse error: Invalid JSON was received by MCP Gateway',
        },
      },
      { status: 400, headers: corsHeaders }
    );
  }

  // Extract metadata without mutating payload
  const headersObj: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headersObj[key.toLowerCase()] = value;
  });

  const metadata = extractMetadata(headersObj, body);
  const logId = crypto.randomUUID();

  // Step 1: Write initial INTERCEPTED audit log to PostgreSQL and in-memory ledger
  const initialLog = {
    id: logId,
    agentId: metadata.agentId,
    sessionId: metadata.sessionId,
    domain: metadata.domain,
    toolName: metadata.toolName,
    payload: body,
    status: 'INTERCEPTED' as const,
    createdAt: new Date().toISOString(),
  };
  recordInMemoryAuditLog(initialLog);

  try {
    await db.insert(schema.agentAuditLogs).values({
      id: logId,
      agentId: metadata.agentId,
      sessionId: metadata.sessionId,
      domain: metadata.domain,
      toolName: metadata.toolName,
      payload: body,
      status: 'INTERCEPTED',
      createdAt: new Date(),
    } as any);
  } catch {
    try {
      await db.insert(schema.agentAuditLogs).values({
        id: logId,
        agentId: metadata.agentId,
        sessionId: metadata.sessionId,
        toolName: metadata.toolName,
        payload: {
          ...body,
          _meta: {
            ...(body?.params?._meta || {}),
            domain: metadata.domain,
          },
        },
        status: 'INTERCEPTED',
        createdAt: new Date(),
      } as any);
    } catch {
      // Continue execution even if PostgreSQL is temporarily unreachable
    }
  }

  // Step 2: Execute MCP verification against formal state machine governors
  const mcpResult = executeInternalMcpCall(body);

  if (!mcpResult) {
    return NextResponse.json(
      {
        jsonrpc: '2.0',
        id: body?.id ?? null,
        error: {
          code: -32601,
          message: `Method not found or unsupported MCP method: ${body?.method}`,
        },
      },
      { status: 404, headers: corsHeaders }
    );
  }

  // Step 3: Evaluate verdict (APPROVED / REJECTED)
  const verdict = evaluateVerdict(200, mcpResult);

  // Update in-memory audit log
  recordInMemoryAuditLog({
    ...initialLog,
    status: verdict,
    response: mcpResult,
  });

  // Step 4: Update PostgreSQL audit log with verdict
  try {
    await db
      .update(schema.agentAuditLogs)
      .set({
        status: verdict,
        response: sanitizeForJsonb(mcpResult),
      })
      .where(eq(schema.agentAuditLogs.id, logId));
  } catch {
    // Secondary DB catch
  }

  // Step 5: Return exact JSON-RPC response to client
  return NextResponse.json(mcpResult, {
    status: 200,
    headers: corsHeaders,
  });
}
