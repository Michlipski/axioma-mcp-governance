import { ApolloServer, HeaderMap } from '@apollo/server';
import { NextRequest } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { resolvers } from '@/graphql/resolvers';

const schemaPath = path.join(process.cwd(), 'src/graphql/schema.graphql');
const typeDefs = fs.readFileSync(schemaPath, 'utf-8');

const server = new ApolloServer({
  typeDefs,
  resolvers,
  csrfPrevention: false,
});

let serverStarted = false;

async function getHandler(): Promise<ApolloServer> {
  if (!serverStarted) {
    await server.start();
    serverStarted = true;
  }
  return server;
}

export async function GET(request: NextRequest): Promise<Response> {
  const apollo = await getHandler();
  const url = new URL(request.url);

  const headers = new HeaderMap();
  request.headers.forEach((value, key) => {
    headers.set(key, value);
  });

  const response = await apollo.executeHTTPGraphQLRequest({
    httpGraphQLRequest: {
      method: 'GET',
      headers,
      search: url.search,
      body: undefined,
    },
    context: async () => ({ req: request }),
  });

  const resHeaders = new Headers();
  response.headers.forEach((value, key) => {
    resHeaders.set(key, value);
  });

  return new Response(
    response.body.kind === 'complete' ? response.body.string : '',
    {
      status: response.status || 200,
      headers: resHeaders,
    }
  );
}

export async function POST(request: NextRequest): Promise<Response> {
  const apollo = await getHandler();
  const url = new URL(request.url);

  const headers = new HeaderMap();
  request.headers.forEach((value, key) => {
    headers.set(key, value);
  });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const response = await apollo.executeHTTPGraphQLRequest({
    httpGraphQLRequest: {
      method: 'POST',
      headers,
      search: url.search,
      body,
    },
    context: async () => ({ req: request }),
  });

  const resHeaders = new Headers();
  response.headers.forEach((value, key) => {
    resHeaders.set(key, value);
  });

  return new Response(
    response.body.kind === 'complete' ? response.body.string : '',
    {
      status: response.status || 200,
      headers: resHeaders,
    }
  );
}
