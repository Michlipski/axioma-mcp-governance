import { createMcpHttpServer } from '../src/mcp/http';
import { createGatewayServer } from '../src/gateway/server';
import { Pool } from 'pg';

async function run() {
  const mcpServer = createMcpHttpServer(3000);
  await new Promise<void>((resolve) => mcpServer.listen(3000, resolve));
  console.log('[1] Core MCP Server listening on http://localhost:3000');

  const gatewayServer = createGatewayServer({
    port: 3001,
    targetMcpUrl: 'http://localhost:3000',
  });
  await new Promise<void>((resolve) => gatewayServer.listen(3001, resolve));
  console.log('[2] MCP Gateway Proxy listening on http://localhost:3001');

  // Call 1: Introspect state boundary
  console.log('\n--> Sending Call 1: introspect_state to Proxy (port 3001)...');
  const res1 = await fetch('http://localhost:3001', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-agent-id': 'agent-feature-planner',
      'x-session-id': 'session-discount-feature-777',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'req-introspect-draft',
      method: 'tools/call',
      params: {
        name: 'introspect_state',
        arguments: { stateName: 'checkout_draft' },
      },
    }),
  });
  const data1 = await res1.json();
  console.log('Proxy response status:', res1.status);

  // Call 2: Illegal proposal - Applying discount in empty_cart
  console.log('\n--> Sending Call 2: Illegal propose_resolver (from empty_cart) to Proxy (port 3001)...');
  const res2 = await fetch('http://localhost:3001', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-agent-id': 'agent-discount-builder',
      'x-session-id': 'session-discount-feature-777',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'req-illegal-discount-call',
      method: 'tools/call',
      params: {
        name: 'propose_resolver',
        arguments: {
          mutationName: 'applyDiscountCode',
          sourceState: 'empty_cart',
          event: 'APPLY_DISCOUNT',
          payload: { orderId: 'ord_123', code: 'SAVE10' },
          implementationCode: 'console.log("bypassing empty cart");',
        },
      },
    }),
  });
  const data2 = await res2.json();
  console.log('Proxy response status:', res2.status);

  // Call 3: Legal proposal - Applying discount in checkout_draft
  console.log('\n--> Sending Call 3: Legal propose_resolver (from checkout_draft) to Proxy (port 3001)...');
  const res3 = await fetch('http://localhost:3001', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-agent-id': 'agent-discount-builder',
      'x-session-id': 'session-discount-feature-777',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'req-approved-discount-call',
      method: 'tools/call',
      params: {
        name: 'propose_resolver',
        arguments: {
          mutationName: 'applyDiscountCode',
          sourceState: 'checkout_draft',
          event: 'APPLY_DISCOUNT',
          payload: { orderId: 'ord_draft_888', code: 'SAVE20' },
          implementationCode: 'await db.update(orders).set({ discountCode: "SAVE20", discountCents: 2000 });',
        },
      },
    }),
  });
  const data3 = await res3.json();
  console.log('Proxy response status:', res3.status);

  // Close HTTP servers
  await new Promise<void>((resolve) => gatewayServer.close(() => resolve()));
  await new Promise<void>((resolve) => mcpServer.close(() => resolve()));
  console.log('\n[3] Servers shut down cleanly.');

  // Query PostgreSQL directly
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/axioma',
  });

  console.log('\n[4] Executing PostgreSQL audit query:');
  const query = `
    SELECT 
      id,
      agent_id,
      session_id,
      tool_name,
      status,
      payload->'id' AS rpc_id,
      payload->'params'->>'name' AS tool_called,
      payload->'params'->'arguments'->>'sourceState' AS source_state,
      payload->'params'->'arguments'->'payload'->>'code' AS discount_code,
      response->'result'->'content'->0->>'text' AS state_machine_feedback,
      created_at
    FROM agent_audit_logs
    ORDER BY created_at ASC;
  `;

  const queryResult = await pool.query(query);
  console.log('\n===== POSTGRESQL AUDIT TABLE ROWS =====');
  console.table(
    queryResult.rows.map((r) => ({
      id: r.id.substring(0, 8) + '...',
      agent: r.agent_id,
      status: r.status,
      rpc_id: r.rpc_id,
      tool: r.tool_called,
      state: r.source_state,
      code: r.discount_code,
      feedback: r.state_machine_feedback ? JSON.parse(r.state_machine_feedback).feedback : null,
    }))
  );

  console.log('\n===== FULL RECORD SAMPLES =====');
  console.log(JSON.stringify(queryResult.rows, null, 2));

  await pool.end();
}

run().catch(console.error);
