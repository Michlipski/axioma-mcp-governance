/**
 * True Axioma MCP Server (HTTP JSON-RPC Transport)
 * Runs on port 3000 to serve XState & GraphQL state boundary governance.
 */

import http from 'node:http';
import { AxiomaMCPServer, DomainName } from './server';

export function createMcpHttpServer(port: number = 3000): http.Server {
  const axioma = new AxiomaMCPServer();

  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'UP', service: 'Axioma Core MCP Server', port }));
      return;
    }

    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        if (!raw.trim()) {
          res.writeHead(200);
          res.end(JSON.stringify({ jsonrpc: '2.0', id: null, result: { status: 'acknowledged' } }));
          return;
        }

        const body = JSON.parse(raw);
        const { id, method, params } = body;
        const domainHeader = (req.headers['x-domain'] || req.headers['domain']) as DomainName | undefined;

        if (method === 'tools/call') {
          const toolName = params?.name;
          const args = params?.arguments || {};
          const domain = args.domain || domainHeader;

          if (toolName === 'propose_resolver') {
            const result = axioma.proposeResolver({
              ...args,
              domain: domain || args.domain,
            });
            res.writeHead(200);
            res.end(
              JSON.stringify({
                jsonrpc: '2.0',
                id,
                result: {
                  isError: result.status === 'REJECTED',
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify(result, null, 2),
                    },
                  ],
                },
              })
            );
            return;
          }

          if (toolName === 'introspect_state') {
            try {
              const result = axioma.introspectStateBoundary(args.stateName, domain);
              res.writeHead(200);
              res.end(
                JSON.stringify({
                  jsonrpc: '2.0',
                  id,
                  result: {
                    content: [
                      {
                        type: 'text',
                        text: JSON.stringify(result, null, 2),
                      },
                    ],
                  },
                })
              );
            } catch (err: any) {
              res.writeHead(200);
              res.end(
                JSON.stringify({
                  jsonrpc: '2.0',
                  id,
                  result: {
                    isError: true,
                    content: [{ type: 'text', text: err.message }],
                  },
                })
              );
            }
            return;
          }
        }

        if (method === 'resources/read') {
          const uri = params?.uri;

          // Fulfillment Domain Resources
          if (uri === 'axioma://domains/fulfillment/schema') {
            res.writeHead(200);
            res.end(
              JSON.stringify({
                jsonrpc: '2.0',
                id,
                result: {
                  contents: [{ uri, text: axioma.getGraphQLSchema('fulfillment'), mimeType: 'text/plain' }],
                },
              })
            );
            return;
          }
          if (uri === 'axioma://domains/fulfillment/state') {
            res.writeHead(200);
            res.end(
              JSON.stringify({
                jsonrpc: '2.0',
                id,
                result: {
                  contents: [{ uri, text: axioma.getStateMachineSource('fulfillment'), mimeType: 'text/plain' }],
                },
              })
            );
            return;
          }

          // Checkout Domain Resources
          if (uri === 'axioma://domains/checkout/schema' || uri === 'axioma://schema/graphql') {
            res.writeHead(200);
            res.end(
              JSON.stringify({
                jsonrpc: '2.0',
                id,
                result: {
                  contents: [{ uri, text: axioma.getGraphQLSchema('checkout'), mimeType: 'text/plain' }],
                },
              })
            );
            return;
          }
          if (uri === 'axioma://domains/checkout/state' || uri === 'axioma://machines/checkout') {
            res.writeHead(200);
            res.end(
              JSON.stringify({
                jsonrpc: '2.0',
                id,
                result: {
                  contents: [{ uri, text: axioma.getStateMachineSource('checkout'), mimeType: 'text/plain' }],
                },
              })
            );
            return;
          }
          if (uri === 'axioma://machines/json') {
            res.writeHead(200);
            res.end(
              JSON.stringify({
                jsonrpc: '2.0',
                id,
                result: {
                  contents: [{ uri, text: JSON.stringify(axioma.getStateMachineJSON('checkout'), null, 2), mimeType: 'application/json' }],
                },
              })
            );
            return;
          }
        }

        // Default MCP tools list or initialize
        if (method === 'tools/list') {
          res.writeHead(200);
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id,
              result: {
                tools: [
                  { name: 'introspect_state', description: 'Introspect state boundary' },
                  { name: 'propose_resolver', description: 'Propose resolver implementation' },
                ],
              },
            })
          );
          return;
        }

        res.writeHead(200);
        res.end(JSON.stringify({ jsonrpc: '2.0', id, result: { status: 'acknowledged' } }));
      } catch (err: any) {
        res.writeHead(400);
        res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: err.message } }));
      }
    });
  });

  return server;
}

if (process.argv[1]?.endsWith('src/mcp/http.ts')) {
  const port = Number(process.env.MCP_PORT || 3000);
  const server = createMcpHttpServer(port);
  server.listen(port, () => {
    process.stdout.write(`[Axioma Core MCP Server] Listening on http://localhost:${port}\n`);
  });
}
