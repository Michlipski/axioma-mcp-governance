import { NextRequest, NextResponse } from 'next/server';
import { db, schema } from '@/db';
import { desc, eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limitParam = searchParams.get('limit');
  const limit = limitParam ? Math.max(1, Math.min(100, parseInt(limitParam, 10) || 20)) : 20;
  const domainParam = searchParams.get('domain')?.toLowerCase();

  try {
    const whereClause =
      domainParam && domainParam !== 'all'
        ? eq(schema.agentAuditLogs.domain, domainParam)
        : undefined;

    const rawLogs = await db.query.agentAuditLogs.findMany({
      where: whereClause,
      orderBy: [desc(schema.agentAuditLogs.createdAt)],
      limit,
    });

    const logs = rawLogs.map((log) => {
      const inferredDomain =
        log.domain ||
        (log.payload as any)?.params?._meta?.domain ||
        (log.payload as any)?.params?.arguments?.domain ||
        (log.agentId?.includes('fulfillment') ? 'fulfillment' : 'checkout');

      return {
        ...log,
        domain: inferredDomain,
      };
    });

    return NextResponse.json({
      status: 'OK',
      count: logs.length,
      limit,
      domainFilter: domainParam || 'all',
      logs,
    });
  } catch (err: any) {
    // Graceful fallback if PostgreSQL is temporarily unreachable or offline
    return NextResponse.json(
      {
        status: 'DATABASE_UNAVAILABLE',
        error: err?.message || 'PostgreSQL database is currently unreachable',
        count: 0,
        limit,
        logs: [],
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );
  }
}
