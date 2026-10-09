#!/usr/bin/env node
/**
 * Axioma Architecture MCP Server Executable
 * Runs the MCP server over standard I/O for integration with AI assistants and Antigravity subagents.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createAxiomaMcpServer } from './server';

async function main() {
  const server = createAxiomaMcpServer();
  const transport = new StdioServerTransport();

  process.stderr.write('[Axioma MCP] Connecting Axioma Governance Server to stdio transport...\n');
  await server.connect(transport);
  process.stderr.write('[Axioma MCP] Server running and listening for MCP requests via stdio.\n');
}

main().catch((error) => {
  process.stderr.write(`[Axioma MCP] Fatal error: ${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exit(1);
});
