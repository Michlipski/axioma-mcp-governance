import React from 'react';
import { db, schema } from '@/db';
import { desc } from 'drizzle-orm';
import Link from 'next/link';
import { AutoRefresh } from './AutoRefresh';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface AuditLogRecord {
  id: string;
  agentId: string;
  sessionId: string;
  toolName: string;
  payload: any;
  response: any;
  status: 'INTERCEPTED' | 'APPROVED' | 'REJECTED';
  createdAt: Date;
}

export default async function GovernanceDashboardPage() {
  let logs: AuditLogRecord[] = [];
  let dbError: string | null = null;

  try {
    logs = await db.query.agentAuditLogs.findMany({
      orderBy: [desc(schema.agentAuditLogs.createdAt)],
      limit: 100,
    });
  } catch (err: any) {
    dbError = err?.message || 'Database query error';
  }

  // Summary statistics
  const totalCalls = logs.length;
  const approvedCalls = logs.filter((l) => l.status === 'APPROVED').length;
  const rejectedCalls = logs.filter((l) => l.status === 'REJECTED').length;
  const interceptedCalls = logs.filter((l) => l.status === 'INTERCEPTED').length;
  const blockRate = totalCalls > 0 ? ((rejectedCalls / totalCalls) * 100).toFixed(1) : '0.0';

  return (
    <main
      style={{
        maxWidth: 1200,
        margin: '32px auto',
        padding: '0 24px',
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
      className="max-w-6xl mx-auto px-6 py-8"
    >
      {/* Auto-refresh feed every 5 seconds for real-time telemetry (client-side, cleans up on unmount) */}
      <AutoRefresh intervalMs={5000} />

      {/* Header */}
      <header
        style={{
          borderBottom: '1px solid #e2e8f0',
          paddingBottom: 24,
          marginBottom: 24,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: 16,
        }}
        className="border-b border-slate-200 pb-6 mb-6 flex justify-between items-start flex-wrap gap-4"
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span
              style={{
                display: 'inline-block',
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: '#10b981',
                boxShadow: '0 0 8px #10b981',
              }}
              className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"
            />
            <span
              style={{
                fontSize: '0.8rem',
                letterSpacing: 1.2,
                fontWeight: 700,
                textTransform: 'uppercase',
                color: '#64748b',
              }}
              className="text-xs font-bold tracking-wider uppercase text-slate-500"
            >
              Zero-Trust AI Gateway &bull; Live Telemetry Feed
            </span>
          </div>
          <h1
            style={{ fontSize: '2rem', fontWeight: 800, margin: '0 0 8px 0', color: '#0f172a' }}
            className="text-3xl font-extrabold text-slate-900 tracking-tight"
          >
            Axioma AI Security & Governance Dashboard
          </h1>
          <p style={{ color: '#64748b', margin: 0, fontSize: '0.95rem' }} className="text-slate-500 text-sm">
            Auditing JSON-RPC tool calls from autonomous LLM agents to XState/GraphQL boundaries. Proxy on port <code>3001</code> &rarr; Core MCP server on port <code>3000</code>.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }} className="flex items-center gap-2">
          <Link
            href="/"
            style={{
              padding: '8px 14px',
              fontSize: '0.85rem',
              fontWeight: 600,
              background: '#f1f5f9',
              color: '#334155',
              borderRadius: 6,
              textDecoration: 'none',
              border: '1px solid #cbd5e1',
            }}
            className="px-3.5 py-2 text-xs font-semibold bg-slate-100 text-slate-700 rounded-md border border-slate-300 hover:bg-slate-200"
          >
            &larr; Checkout Sandbox
          </Link>
          <Link
            href="/showcase"
            style={{
              padding: '8px 14px',
              fontSize: '0.85rem',
              fontWeight: 600,
              background: '#047857',
              color: '#ecfdf5',
              borderRadius: 6,
              textDecoration: 'none',
              border: '1px solid #059669',
            }}
            className="px-3.5 py-2 text-xs font-semibold bg-emerald-700 text-emerald-50 rounded-md border border-emerald-600 hover:bg-emerald-600"
          >
            Showcase Flight Simulator &rarr;
          </Link>
          <span
            style={{
              padding: '6px 12px',
              fontSize: '0.75rem',
              fontWeight: 700,
              background: '#0f172a',
              color: '#f8fafc',
              borderRadius: 20,
              letterSpacing: 0.5,
            }}
            className="px-3 py-1.5 text-xs font-bold bg-slate-900 text-slate-50 rounded-full"
          >
            GATEWAY ACTIVE (:3001)
          </span>
        </div>
      </header>

      {/* Database Connection Notice if applicable */}
      {dbError && (
        <div
          style={{
            background: '#fef2f2',
            border: '1px solid #f87171',
            borderRadius: 8,
            padding: 16,
            marginBottom: 24,
            color: '#991b1b',
          }}
          className="bg-red-50 border border-red-300 rounded-lg p-4 mb-6 text-red-800 text-sm"
        >
          <strong>Database Connection Notice:</strong> {dbError}
          <div style={{ marginTop: 6, fontSize: '0.85rem', color: '#b91c1c' }}>
            Ensure PostgreSQL is running and <code>DATABASE_URL</code> is properly configured in your environment.
          </div>
        </div>
      )}

      {/* Telemetry Stat Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 16,
          marginBottom: 28,
        }}
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-7"
      >
        <div
          style={{
            background: '#ffffff',
            padding: 18,
            borderRadius: 8,
            border: '1px solid #e2e8f0',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          }}
          className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm"
        >
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }} className="text-xs font-semibold text-slate-500 uppercase">
            Total Intercepted Calls
          </span>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#0f172a', marginTop: 4 }} className="text-2xl font-extrabold text-slate-900 mt-1">
            {totalCalls}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 4 }} className="text-xs text-slate-400 mt-1">
            All MCP JSON-RPC attempts
          </div>
        </div>

        <div
          style={{
            background: '#ffffff',
            padding: 18,
            borderRadius: 8,
            border: '1px solid #bbf7d0',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          }}
          className="bg-white p-4 rounded-lg border border-emerald-200 shadow-sm"
        >
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#059669', textTransform: 'uppercase' }} className="text-xs font-semibold text-emerald-600 uppercase">
            Approved Proposals
          </span>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#059669', marginTop: 4 }} className="text-2xl font-extrabold text-emerald-600 mt-1">
            {approvedCalls}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#10b981', marginTop: 4 }} className="text-xs text-emerald-500 mt-1">
            Satisfied state invariants
          </div>
        </div>

        <div
          style={{
            background: '#ffffff',
            padding: 18,
            borderRadius: 8,
            border: '1px solid #fecdd3',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          }}
          className="bg-white p-4 rounded-lg border border-rose-200 shadow-sm"
        >
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#e11d48', textTransform: 'uppercase' }} className="text-xs font-semibold text-rose-600 uppercase">
            Rejected Violations
          </span>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#e11d48', marginTop: 4 }} className="text-2xl font-extrabold text-rose-600 mt-1">
            {rejectedCalls}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#f43f5e', marginTop: 4 }} className="text-xs text-rose-500 mt-1">
            Blocked illegal transitions
          </div>
        </div>

        <div
          style={{
            background: '#ffffff',
            padding: 18,
            borderRadius: 8,
            border: '1px solid #e2e8f0',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          }}
          className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm"
        >
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }} className="text-xs font-semibold text-slate-500 uppercase">
            Violation Enforcement Ratio
          </span>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#475569', marginTop: 4 }} className="text-2xl font-extrabold text-slate-700 mt-1">
            {blockRate}%
          </div>
          <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 4 }} className="text-xs text-slate-400 mt-1">
            Axiom protection integrity
          </div>
        </div>
      </div>

      {/* Main Audit Feed */}
      <section
        style={{
          background: '#ffffff',
          borderRadius: 8,
          border: '1px solid #e2e8f0',
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          overflow: 'hidden',
        }}
        className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden"
      >
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #f1f5f9',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
          className="p-4 border-b border-slate-100 flex justify-between items-center"
        >
          <div>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, color: '#0f172a' }} className="text-lg font-bold text-slate-900">
              Audit Feed &bull; <code>agent_audit_logs</code>
            </h2>
            <p style={{ margin: '2px 0 0 0', fontSize: '0.8rem', color: '#64748b' }} className="text-xs text-slate-500">
              Real-time, immutable transaction trail captured at proxy port <code>3001</code>
            </p>
          </div>
          <div style={{ fontSize: '0.8rem', color: '#94a3b8' }} className="text-xs text-slate-400">
            Auto-refreshes every 5s
          </div>
        </div>

        {logs.length === 0 ? (
          <div style={{ padding: '60px 20px', textAlign: 'center', color: '#64748b' }} className="p-16 text-center text-slate-500">
            <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>🛡️</div>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, margin: '0 0 6px 0', color: '#1e293b' }} className="text-base font-semibold text-slate-800">
              No Agent Tool Calls Intercepted Yet
            </h3>
            <p style={{ maxWidth: 520, margin: '0 auto 16px auto', fontSize: '0.85rem' }} className="max-w-md mx-auto text-xs text-slate-500">
              The MCP Gateway on port <code>3001</code> is actively listening. When an autonomous agent issues a JSON-RPC request to <code>tools/call</code>, telemetry and mathematical verdicts will stream here automatically.
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }} className="w-full border-collapse text-left text-xs">
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }} className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                  <th style={{ padding: '12px 16px' }} className="p-3 pl-4">Verdict</th>
                  <th style={{ padding: '12px 16px' }} className="p-3">Tool / Method</th>
                  <th style={{ padding: '12px 16px' }} className="p-3">Agent ID</th>
                  <th style={{ padding: '12px 16px' }} className="p-3">Session</th>
                  <th style={{ padding: '12px 16px' }} className="p-3">Timestamp</th>
                  <th style={{ padding: '12px 16px' }} className="p-3 pr-4">Inspection</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => {
                  const isApproved = log.status === 'APPROVED';
                  const isRejected = log.status === 'REJECTED';

                  const badgeBg = isApproved ? '#dcfce7' : isRejected ? '#fee2e2' : '#fef3c7';
                  const badgeColor = isApproved ? '#15803d' : isRejected ? '#b91c1c' : '#b45309';
                  const badgeBorder = isApproved ? '#86efac' : isRejected ? '#fca5a5' : '#fde68a';
                  const badgeIcon = isApproved ? '✓' : isRejected ? '✗' : '⏳';

                  // Extract tool args and response feedback
                  const toolArgs = log.payload?.params?.arguments || log.payload?.params || {};
                  const responseData = log.response?.result?.content?.[0]?.text
                    ? safeJsonParse(log.response.result.content[0].text)
                    : log.response;

                  return (
                    <tr
                      key={log.id}
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        background: isRejected ? '#fffbfb' : '#ffffff',
                      }}
                      className="border-b border-slate-100 hover:bg-slate-50/80 transition-colors"
                    >
                      {/* Verdict Badge */}
                      <td style={{ padding: '14px 16px', verticalAlign: 'top' }} className="p-3 pl-4 align-top">
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '4px 10px',
                            borderRadius: 12,
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            background: badgeBg,
                            color: badgeColor,
                            border: `1px solid ${badgeBorder}`,
                            letterSpacing: 0.5,
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold"
                        >
                          <span>{badgeIcon}</span>
                          <span>{log.status}</span>
                        </span>
                      </td>

                      {/* Tool Name */}
                      <td style={{ padding: '14px 16px', verticalAlign: 'top' }} className="p-3 align-top">
                        <div style={{ fontWeight: 700, color: '#0f172a' }} className="font-bold text-slate-900">
                          {log.toolName}
                        </div>
                        {toolArgs.mutationName && (
                          <div style={{ color: '#64748b', fontSize: '0.75rem', marginTop: 2 }} className="text-xs text-slate-500">
                            Mutation: <code style={{ color: '#475569' }}>{toolArgs.mutationName}</code>
                          </div>
                        )}
                        {toolArgs.sourceState && (
                          <div style={{ color: '#64748b', fontSize: '0.75rem' }} className="text-xs text-slate-500">
                            State: <code style={{ color: '#8b5cf6' }}>{toolArgs.sourceState}</code> &rarr; Event: <code style={{ color: '#2563eb' }}>{toolArgs.event}</code>
                          </div>
                        )}
                      </td>

                      {/* Agent ID */}
                      <td style={{ padding: '14px 16px', verticalAlign: 'top', color: '#334155' }} className="p-3 align-top text-slate-700 font-mono text-xs">
                        {log.agentId}
                      </td>

                      {/* Session ID */}
                      <td style={{ padding: '14px 16px', verticalAlign: 'top', color: '#64748b', fontFamily: 'monospace' }} className="p-3 align-top text-slate-500 font-mono text-xs">
                        {String(log.sessionId).slice(0, 16)}...
                      </td>

                      {/* Timestamp */}
                      <td style={{ padding: '14px 16px', verticalAlign: 'top', color: '#64748b' }} className="p-3 align-top text-slate-500 text-xs whitespace-nowrap">
                        {new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                          {new Date(log.createdAt).toISOString().split('T')[0]}
                        </div>
                      </td>

                      {/* Detailed Payload & Verdict Viewer */}
                      <td style={{ padding: '14px 16px', verticalAlign: 'top' }} className="p-3 pr-4 align-top">
                        <details style={{ cursor: 'pointer' }}>
                          <summary
                            style={{
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              color: isRejected ? '#e11d48' : '#2563eb',
                              outline: 'none',
                            }}
                            className="text-xs font-semibold hover:underline"
                          >
                            {isRejected ? 'View Violation Reason & Payload' : 'View Payload & Verdict'}
                          </summary>

                          <div
                            style={{
                              marginTop: 8,
                              padding: 10,
                              background: '#f8fafc',
                              borderRadius: 6,
                              border: '1px solid #e2e8f0',
                              maxWidth: 420,
                            }}
                            className="mt-2 p-2.5 bg-slate-50 rounded border border-slate-200 text-xs max-w-md"
                          >
                            {/* Violation callout if rejected */}
                            {isRejected && responseData?.violations && (
                              <div
                                style={{
                                  padding: 8,
                                  background: '#fee2e2',
                                  color: '#991b1b',
                                  borderRadius: 4,
                                  marginBottom: 8,
                                  fontSize: '0.75rem',
                                  fontWeight: 600,
                                }}
                                className="p-2 bg-red-100 text-red-800 rounded mb-2 text-xs font-semibold"
                              >
                                Violations: {Array.isArray(responseData.violations) ? responseData.violations.join(', ') : String(responseData.violations)}
                              </div>
                            )}

                            {responseData?.feedback && (
                              <div style={{ marginBottom: 8, color: '#334155', fontSize: '0.75rem' }} className="mb-2 text-slate-700 text-xs">
                                <strong>Feedback:</strong> {responseData.feedback}
                              </div>
                            )}

                            {/* Raw Payload Preview */}
                            <div style={{ color: '#475569', fontWeight: 600, fontSize: '0.7rem', marginBottom: 2 }}>
                              INTERCEPTED PAYLOAD:
                            </div>
                            <pre
                              style={{
                                margin: 0,
                                padding: 6,
                                background: '#0f172a',
                                color: '#e2e8f0',
                                borderRadius: 4,
                                fontSize: '0.68rem',
                                overflowX: 'auto',
                                maxHeight: 150,
                              }}
                              className="bg-slate-900 text-slate-200 p-2 rounded text-2xs overflow-auto max-h-36"
                            >
                              {JSON.stringify(log.payload, null, 2)}
                            </pre>
                          </div>
                        </details>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Footer architecture indicator */}
      <footer
        style={{
          marginTop: 32,
          paddingTop: 16,
          borderTop: '1px solid #e2e8f0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '0.8rem',
          color: '#94a3b8',
        }}
        className="mt-8 pt-4 border-t border-slate-200 flex justify-between items-center text-xs text-slate-400"
      >
        <div>
          Axioma Architecture Zero-Trust Gateway &bull; Immutability Enforced
        </div>
        <div>
          Table: <code>public.agent_audit_logs</code>
        </div>
      </footer>
    </main>
  );
}

function safeJsonParse(val: string): any {
  try {
    return JSON.parse(val);
  } catch {
    return { raw: val };
  }
}
