import fs from 'node:fs';
import { AxiomaMCPServer } from '../src/mcp/server';

const server = new AxiomaMCPServer();
const [command, arg1, arg2] = process.argv.slice(2);

async function run() {
  if (command === 'resource') {
    if (arg1 === 'schema') {
      console.log(server.getGraphQLSchema());
    } else if (arg1 === 'machine') {
      console.log(server.getStateMachineSource());
    } else if (arg1 === 'json') {
      console.log(JSON.stringify(server.getStateMachineJSON(), null, 2));
    } else {
      console.error('Unknown resource. Available: schema, machine, json');
      process.exit(1);
    }
  } else if (command === 'introspect') {
    if (!arg1) {
      console.error('Usage: introspect <stateName>');
      process.exit(1);
    }
    const res = server.introspectStateBoundary(arg1);
    console.log(JSON.stringify(res, null, 2));
  } else if (command === 'propose') {
    if (!arg1) {
      console.error('Usage: propose <path-to-proposal.json>');
      process.exit(1);
    }
    const raw = fs.readFileSync(arg1, 'utf-8');
    const input = JSON.parse(raw);
    const result = server.proposeResolver(input);
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`
Axioma MCP Query CLI
Usage:
  npx tsx scripts/mcp-query.ts resource <schema|machine|json>
  npx tsx scripts/mcp-query.ts introspect <stateName>
  npx tsx scripts/mcp-query.ts propose <path-to-proposal.json>
`);
  }
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
