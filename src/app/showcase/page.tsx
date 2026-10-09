'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

// Preset scenario fixtures
import scenario1 from '../../../showcase/scenarios/01-illegal-discount-on-empty-cart.json';
import scenario2 from '../../../showcase/scenarios/02-valid-checkout-and-payment.json';
import scenario3 from '../../../showcase/scenarios/03-missing-idempotency-key.json';

interface AuditLogRecord {
  id: string;
  agentId: string;
  sessionId: string;
  toolName: string;
  payload: any;
  response: any;
  status: 'INTERCEPTED' | 'APPROVED' | 'REJECTED';
  createdAt: string;
}

interface StateNodeConfig {
  name: string;
  label: string;
  description: string;
  admissibleEvents: string[];
  illegalEvents: string[];
  guards: string[];
}

const STATE_TOPOLOGY: Record<string, StateNodeConfig> = {
  empty_cart: {
    name: 'empty_cart',
    label: 'Empty Cart',
    description: 'Initial state. Mathematical axiom: cart has zero items. Financial and checkout mutations are strictly prohibited.',
    admissibleEvents: ['ADD_ITEM'],
    illegalEvents: ['APPLY_DISCOUNT', 'SUBMIT_PAYMENT', 'INITIATE_CHECKOUT', 'ATTACH_SHIPPING'],
    guards: ['Cart must contain at least 1 item before entering checkout'],
  },
  checkout_draft: {
    name: 'checkout_draft',
    label: 'Checkout Draft',
    description: 'Cart is locked for checkout. Awaiting customer shipping information and optional promotion codes.',
    admissibleEvents: ['ATTACH_SHIPPING', 'APPLY_DISCOUNT', 'REMOVE_DISCOUNT', 'CANCEL_CHECKOUT'],
    illegalEvents: ['SUBMIT_PAYMENT', 'ADD_ITEM', 'DISPATCH_FULFILLMENT'],
    guards: ['isValidShippingAddress: Recipient, address line, city, postal code, and country required'],
  },
  pending_payment: {
    name: 'pending_payment',
    label: 'Pending Payment',
    description: 'Order totals are frozen. Gateway transactions can be proposed with strict idempotency verification.',
    admissibleEvents: ['SUBMIT_PAYMENT', 'CANCEL_CHECKOUT'],
    illegalEvents: ['ADD_ITEM', 'APPLY_DISCOUNT', 'DISPATCH_FULFILLMENT'],
    guards: [
      'hasIdempotencyKey: Non-empty string required',
      'validPositiveAmount: amountCents must strictly match totalCents',
      'orderId must be present',
    ],
  },
  paid: {
    name: 'paid',
    label: 'Paid (Settled)',
    description: 'Commercial contract settled and finalized. Double-charging blocked. Awaiting warehouse carrier dispatch.',
    admissibleEvents: ['DISPATCH_FULFILLMENT'],
    illegalEvents: ['SUBMIT_PAYMENT', 'CANCEL_CHECKOUT', 'APPLY_DISCOUNT', 'ATTACH_SHIPPING'],
    guards: ['hasValidTracking: Carrier name and non-empty trackingNumber required'],
  },
};

const PRESETS = [
  {
    id: 'scenario-01',
    badge: 'SCENARIO 01',
    name: 'Rogue Agent: Attempt Discount on Empty Cart',
    expected: 'REJECTED' as const,
    sourceState: 'empty_cart',
    event: 'APPLY_DISCOUNT',
    description: 'Agent attempts to apply discount mutation before items exist. State boundary rejects transition mathematically.',
    fixture: scenario1,
  },
  {
    id: 'scenario-02',
    badge: 'SCENARIO 02',
    name: 'Compliant Agent: Execute Complete Legal Checkout',
    expected: 'APPROVED' as const,
    sourceState: 'pending_payment',
    event: 'SUBMIT_PAYMENT',
    description: 'Agent satisfies all invariants: state is pending_payment, idempotency key provided, and amount strictly matches.',
    fixture: scenario2,
  },
  {
    id: 'scenario-03',
    badge: 'SCENARIO 03',
    name: 'Rogue Agent: Submit Payment Without Idempotency Key',
    expected: 'REJECTED' as const,
    sourceState: 'pending_payment',
    event: 'SUBMIT_PAYMENT',
    description: 'Agent attempts payment submission omitting idempotency key. State guard evaluator flags guard violation.',
    fixture: scenario3,
  },
];

export default function ShowcasePage() {
  const [activeState, setActiveState] = useState<string>('empty_cart');
  const [selectedPresetId, setSelectedPresetId] = useState<string>('scenario-01');
  const [customRpcJson, setCustomRpcJson] = useState<string>(
    JSON.stringify(scenario1.rpcRequest, null, 2)
  );

  // Dispatch execution state
  const [isDispatching, setIsDispatching] = useState<boolean>(false);
  const [lastDispatchResponse, setLastDispatchResponse] = useState<any | null>(null);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [gatewayStatus, setGatewayStatus] = useState<'UP' | 'DOWN' | 'CHECKING'>('CHECKING');

  // Audit stream state
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [dbStatus, setDbStatus] = useState<'OK' | 'UNAVAILABLE' | 'FETCHING'>('FETCHING');
  const [pollingActive, setPollingActive] = useState<boolean>(true);
  const [lastPollTime, setLastPollTime] = useState<string>('');

  // Inspection Drawer
  const [inspectRecord, setInspectRecord] = useState<AuditLogRecord | null>(null);

  // Ping Gateway status on load
  const checkGatewayHealth = useCallback(async () => {
    try {
      const res = await fetch('http://localhost:3001/health', { method: 'GET' });
      if (res.ok) {
        setGatewayStatus('UP');
      } else {
        setGatewayStatus('DOWN');
      }
    } catch {
      setGatewayStatus('DOWN');
    }
  }, []);

  // Poll audit logs from Next.js API route
  const fetchAuditLogs = useCallback(async () => {
    try {
      const res = await fetch('/api/audit-logs?limit=25');
      if (!res.ok) {
        setDbStatus('UNAVAILABLE');
        return;
      }
      const data = await res.json();
      if (data.status === 'DATABASE_UNAVAILABLE') {
        setDbStatus('UNAVAILABLE');
      } else {
        setDbStatus('OK');
        setAuditLogs(data.logs || []);
      }
      setLastPollTime(new Date().toLocaleTimeString());
    } catch {
      setDbStatus('UNAVAILABLE');
    }
  }, []);

  useEffect(() => {
    checkGatewayHealth();
    fetchAuditLogs();

    const interval = setInterval(() => {
      checkGatewayHealth();
      if (pollingActive) {
        fetchAuditLogs();
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [checkGatewayHealth, fetchAuditLogs, pollingActive]);

  // Handle Preset selection
  const selectPreset = (presetId: string) => {
    setSelectedPresetId(presetId);
    const preset = PRESETS.find((p) => p.id === presetId);
    if (preset) {
      setActiveState(preset.sourceState);
      setCustomRpcJson(JSON.stringify(preset.fixture.rpcRequest, null, 2));
      setLastDispatchResponse(null);
      setDispatchError(null);
    }
  };

  // Dispatch JSON-RPC to Gateway (Port 3001)
  const handleDispatch = async () => {
    setIsDispatching(true);
    setDispatchError(null);
    setLastDispatchResponse(null);

    let parsedPayload: any;
    try {
      parsedPayload = JSON.parse(customRpcJson);
    } catch (err: any) {
      setDispatchError(`JSON Parse Error: ${err.message}`);
      setIsDispatching(false);
      return;
    }

    // Extract headers for Gateway metadata
    const agentId = parsedPayload?.params?._meta?.agentId || 'agent-axioma-subagent';
    const sessionId = parsedPayload?.params?._meta?.sessionId || `sim-${Date.now()}`;

    try {
      // Must hit port 3001 (MCP Gateway proxy)
      const res = await fetch('http://localhost:3001/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-agent-id': agentId,
          'x-session-id': sessionId,
        },
        body: JSON.stringify(parsedPayload),
      });

      const rawText = await res.text();
      let responseJson: any;
      try {
        responseJson = JSON.parse(rawText);
      } catch {
        setDispatchError(
          `Gateway returned non-JSON response (HTTP ${res.status}): ${rawText.slice(0, 250)}`
        );
        setIsDispatching(false);
        return;
      }

      setLastDispatchResponse({
        httpStatus: res.status,
        body: responseJson,
      });

      // Synchronously refresh audit feed to surface the intercepted attempt
      setTimeout(() => {
        fetchAuditLogs();
      }, 500);
    } catch (netErr: any) {
      setDispatchError(
        `Connection to MCP Gateway failed (http://localhost:3001): ${netErr.message}. Ensure 'npm run mcp:gateway' and 'npm run mcp:server' are running.`
      );
    } finally {
      setIsDispatching(false);
    }
  };

  const activeStateConfig = STATE_TOPOLOGY[activeState] || STATE_TOPOLOGY['empty_cart'];

  // Helper to extract verdict from dispatch response
  let evaluatedVerdict: 'APPROVED' | 'REJECTED' | 'PENDING' = 'PENDING';
  if (lastDispatchResponse) {
    const resBody = lastDispatchResponse.body;
    if (lastDispatchResponse.httpStatus >= 400 || resBody?.error) {
      evaluatedVerdict = 'REJECTED';
    } else {
      const isErr = resBody?.result?.isError;
      if (isErr === true) {
        evaluatedVerdict = 'REJECTED';
      } else {
        const textContent = resBody?.result?.content?.[0]?.text;
        if (textContent && textContent.includes('"status": "REJECTED"')) {
          evaluatedVerdict = 'REJECTED';
        } else if (textContent && textContent.includes('"status": "APPROVED"')) {
          evaluatedVerdict = 'APPROVED';
        } else {
          evaluatedVerdict = 'APPROVED';
        }
      }
    }
  }

  return (
    <div
      style={{
        backgroundColor: '#09090b',
        color: '#f4f4f5',
        minHeight: '100vh',
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
      className="bg-zinc-950 text-zinc-100 min-h-screen selection:bg-emerald-500/20 selection:text-emerald-300"
    >
      {/* Top Banner & Header */}
      <header
        style={{
          borderBottom: '1px solid #27272a',
          backgroundColor: '#09090b',
          position: 'sticky',
          top: 0,
          zIndex: 40,
        }}
        className="border-b border-zinc-800 bg-zinc-950/90 backdrop-blur sticky top-0 z-40 px-6 py-4"
      >
        <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                backgroundColor: '#18181b',
                border: '1px solid #3f3f46',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 800,
                color: '#10b981',
                fontSize: '1.1rem',
              }}
              className="w-9 h-9 rounded-lg bg-zinc-900 border border-zinc-700 flex items-center justify-center font-black text-emerald-400"
            >
              &Delta;
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, letterSpacing: '-0.02em', color: '#fafafa' }} className="text-xl font-extrabold tracking-tight text-zinc-50">
                  Axioma Showcase
                </h1>
                <span
                  style={{
                    fontSize: '0.65rem',
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    backgroundColor: '#18181b',
                    color: '#a1a1aa',
                    padding: '2px 8px',
                    borderRadius: 4,
                    border: '1px solid #27272a',
                  }}
                  className="text-2xs font-bold tracking-wider uppercase bg-zinc-900 text-zinc-400 px-2 py-0.5 rounded border border-zinc-800"
                >
                  Governance Flight Simulator
                </span>
              </div>
              <p style={{ margin: '2px 0 0 0', fontSize: '0.8rem', color: '#71717a' }} className="text-xs text-zinc-500">
                Zero-Trust Deterministic Boundaries for Autonomous LLM Agents
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* Gateway Status Badge */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: 20,
                fontSize: '0.75rem',
                fontWeight: 600,
                backgroundColor: gatewayStatus === 'UP' ? '#064e3b' : '#3f1515',
                color: gatewayStatus === 'UP' ? '#6ee7b7' : '#fca5a5',
                border: `1px solid ${gatewayStatus === 'UP' ? '#059669' : '#b91c1c'}`,
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${
                gatewayStatus === 'UP' ? 'bg-emerald-950 text-emerald-300 border-emerald-700' : 'bg-rose-950 text-rose-300 border-rose-800'
              }`}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: gatewayStatus === 'UP' ? '#10b981' : '#ef4444',
                }}
                className={`w-2 h-2 rounded-full ${gatewayStatus === 'UP' ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'}`}
              />
              Gateway :3001 &bull; {gatewayStatus === 'UP' ? 'ACTIVE PROXY' : 'DISCONNECTED'}
            </div>

            {/* Links */}
            <Link
              href="/governance"
              style={{
                padding: '6px 12px',
                fontSize: '0.75rem',
                fontWeight: 600,
                color: '#d4d4d8',
                backgroundColor: '#18181b',
                border: '1px solid #27272a',
                borderRadius: 6,
                textDecoration: 'none',
              }}
              className="px-3 py-1.5 text-xs font-semibold text-zinc-300 bg-zinc-900 border border-zinc-800 rounded hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
            >
              Governance Telemetry &rarr;
            </Link>

            <Link
              href="/"
              style={{
                padding: '6px 12px',
                fontSize: '0.75rem',
                fontWeight: 600,
                color: '#d4d4d8',
                backgroundColor: '#18181b',
                border: '1px solid #27272a',
                borderRadius: 6,
                textDecoration: 'none',
              }}
              className="px-3 py-1.5 text-xs font-semibold text-zinc-300 bg-zinc-900 border border-zinc-800 rounded hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
            >
              Cart Sandbox
            </Link>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main style={{ maxWidth: 1400, margin: '24px auto', padding: '0 24px' }} className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Gateway Disconnected Warning */}
        {gatewayStatus === 'DOWN' && (
          <div
            style={{
              padding: '14px 18px',
              borderRadius: 8,
              backgroundColor: '#450a0a',
              border: '1px solid #991b1b',
              color: '#fecaca',
              fontSize: '0.85rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
            className="p-4 rounded-lg bg-rose-950/80 border border-rose-800 text-rose-200 text-sm flex justify-between items-center"
          >
            <div>
              <strong>Gateway Disconnected:</strong> Proxy on <code>http://localhost:3001</code> is unreachable.
              <span style={{ marginLeft: 8, color: '#fca5a5' }}>
                Run <code>npm run mcp:gateway</code> in a terminal to enable live interception.
              </span>
            </div>
            <button
              onClick={checkGatewayHealth}
              style={{
                padding: '4px 10px',
                fontSize: '0.75rem',
                backgroundColor: '#7f1d1d',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
              }}
              className="px-2.5 py-1 text-xs bg-rose-900 text-white rounded hover:bg-rose-800 cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}

        {/* SECTION 1: TOPOLOGY & ACTIVE STATE VIEWER */}
        <section
          style={{
            backgroundColor: '#121215',
            border: '1px solid #27272a',
            borderRadius: 12,
            padding: 20,
          }}
          className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5"
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    fontSize: '0.65rem',
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    backgroundColor: '#1e1b4b',
                    color: '#a5b4fc',
                    padding: '2px 8px',
                    borderRadius: 4,
                    border: '1px solid #3730a3',
                  }}
                  className="text-2xs font-bold tracking-wider uppercase bg-indigo-950 text-indigo-300 px-2 py-0.5 rounded border border-indigo-800"
                >
                  Layer 1 &bull; Temporal Verbs
                </span>
                <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: '#fafafa' }} className="text-lg font-bold text-zinc-100">
                  State Machine Topology & Active Node Boundary
                </h2>
              </div>
              <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: '#71717a' }} className="text-xs text-zinc-500">
                Formal XState finite state graph defining legal and mathematically impossible transitions.
              </p>
            </div>

            <div style={{ fontSize: '0.75rem', color: '#a1a1aa' }} className="text-xs text-zinc-400">
              Select node to inspect invariant guards:
            </div>
          </div>

          {/* Finite State Pipeline Diagram */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: 12,
              marginBottom: 20,
            }}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5"
          >
            {Object.keys(STATE_TOPOLOGY).map((key) => {
              const node = STATE_TOPOLOGY[key];
              const isSelected = activeState === key;

              let nodeBadgeColor = '#71717a';
              if (key === 'empty_cart') nodeBadgeColor = '#60a5fa';
              if (key === 'checkout_draft') nodeBadgeColor = '#c084fc';
              if (key === 'pending_payment') nodeBadgeColor = '#fbbf24';
              if (key === 'paid') nodeBadgeColor = '#34d399';

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveState(key)}
                  style={{
                    backgroundColor: isSelected ? '#1c1917' : '#18181b',
                    border: `2px solid ${isSelected ? nodeBadgeColor : '#27272a'}`,
                    borderRadius: 8,
                    padding: 14,
                    textAlign: 'left',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    position: 'relative',
                  }}
                  className={`p-3.5 rounded-lg text-left cursor-pointer transition-all ${
                    isSelected ? 'bg-zinc-900 border-2 shadow-lg ring-1' : 'bg-zinc-900/40 border border-zinc-800 hover:border-zinc-700'
                  }`}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span
                      style={{
                        fontSize: '0.7rem',
                        fontFamily: 'monospace',
                        fontWeight: 700,
                        color: nodeBadgeColor,
                      }}
                      className="text-xs font-mono font-bold"
                    >
                      node: {key}
                    </span>
                    {isSelected && (
                      <span
                        style={{
                          fontSize: '0.65rem',
                          fontWeight: 700,
                          backgroundColor: nodeBadgeColor,
                          color: '#09090b',
                          padding: '2px 6px',
                          borderRadius: 10,
                        }}
                        className="text-2xs font-bold px-1.5 py-0.5 rounded-full uppercase"
                      >
                        Active
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#fafafa', marginBottom: 4 }} className="text-sm font-bold text-zinc-100">
                    {node.label}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#a1a1aa', lineHeight: 1.4 }} className="text-xs text-zinc-400 line-clamp-2">
                    {node.description}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Active Node Guard & Transition Breakdown */}
          <div
            style={{
              backgroundColor: '#18181b',
              border: '1px solid #27272a',
              borderRadius: 8,
              padding: 16,
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
              gap: 16,
            }}
            className="bg-zinc-900/90 border border-zinc-800/80 rounded-lg p-4 grid grid-cols-1 md:grid-cols-3 gap-4"
          >
            {/* Legal Transitions */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    backgroundColor: '#10b981',
                  }}
                  className="w-2 h-2 rounded-full bg-emerald-500"
                />
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#34d399', textTransform: 'uppercase' }} className="text-xs font-bold text-emerald-400 uppercase">
                  Admissible Transitions (Legal Verbs)
                </span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {activeStateConfig.admissibleEvents.map((evt) => (
                  <span
                    key={evt}
                    style={{
                      fontSize: '0.75rem',
                      fontFamily: 'monospace',
                      fontWeight: 600,
                      backgroundColor: '#064e3b',
                      color: '#a7f3d0',
                      border: '1px solid #059669',
                      padding: '3px 8px',
                      borderRadius: 4,
                    }}
                    className="text-xs font-mono font-semibold bg-emerald-950 text-emerald-200 border border-emerald-700 px-2 py-0.5 rounded"
                  >
                    &bull; {evt}
                  </span>
                ))}
              </div>
            </div>

            {/* Illegal Transitions */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    backgroundColor: '#f43f5e',
                  }}
                  className="w-2 h-2 rounded-full bg-rose-500"
                />
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#fb7185', textTransform: 'uppercase' }} className="text-xs font-bold text-rose-400 uppercase">
                  Forbidden Inadmissible Events
                </span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {activeStateConfig.illegalEvents.map((evt) => (
                  <span
                    key={evt}
                    style={{
                      fontSize: '0.75rem',
                      fontFamily: 'monospace',
                      fontWeight: 600,
                      backgroundColor: '#4c0519',
                      color: '#fecdd3',
                      border: '1px solid #be123c',
                      padding: '3px 8px',
                      borderRadius: 4,
                      textDecoration: 'line-through',
                    }}
                    className="text-xs font-mono font-semibold bg-rose-950 text-rose-200 border border-rose-800 px-2 py-0.5 rounded line-through opacity-85"
                  >
                    &times; {evt}
                  </span>
                ))}
              </div>
            </div>

            {/* Guard Invariants */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    backgroundColor: '#eab308',
                  }}
                  className="w-2 h-2 rounded-full bg-amber-500"
                />
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#fcd34d', textTransform: 'uppercase' }} className="text-xs font-bold text-amber-300 uppercase">
                  Evaluated State Guards
                </span>
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.75rem', color: '#d4d4d8' }} className="text-xs text-zinc-300 space-y-1 list-disc pl-4">
                {activeStateConfig.guards.map((g, i) => (
                  <li key={i}>{g}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* SECTION 2: AGENT INTENT DISPATCHER & SIMULATION CONTROLS */}
        <section
          style={{
            backgroundColor: '#121215',
            border: '1px solid #27272a',
            borderRadius: 12,
            padding: 20,
          }}
          className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5"
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    fontSize: '0.65rem',
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    backgroundColor: '#701a75',
                    color: '#f5d0fe',
                    padding: '2px 8px',
                    borderRadius: 4,
                    border: '1px solid #86198f',
                  }}
                  className="text-2xs font-bold tracking-wider uppercase bg-fuchsia-950 text-fuchsia-300 px-2 py-0.5 rounded border border-fuchsia-800"
                >
                  Layer 2 &bull; Agent Dispatcher
                </span>
                <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: '#fafafa' }} className="text-lg font-bold text-zinc-100">
                  Agent Intent Dispatcher (Simulation Controls)
                </h2>
              </div>
              <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: '#71717a' }} className="text-xs text-zinc-500">
                Trigger preset scenarios or dispatch custom JSON-RPC tool proposals through the Gateway proxy on port <code>3001</code>.
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '0.75rem', color: '#71717a' }} className="text-xs text-zinc-500">
                Target: <code>http://localhost:3001</code>
              </span>
            </div>
          </div>

          {/* Preset Buttons */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: 12,
              marginBottom: 16,
            }}
            className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4"
          >
            {PRESETS.map((preset) => {
              const isSelected = selectedPresetId === preset.id;
              const isApproved = preset.expected === 'APPROVED';

              return (
                <div
                  key={preset.id}
                  onClick={() => selectPreset(preset.id)}
                  style={{
                    backgroundColor: isSelected ? '#1c1917' : '#18181b',
                    border: `1px solid ${isSelected ? (isApproved ? '#059669' : '#e11d48') : '#27272a'}`,
                    borderRadius: 8,
                    padding: 14,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  className={`p-3.5 rounded-lg border cursor-pointer transition-all ${
                    isSelected ? 'bg-zinc-900 border-2' : 'bg-zinc-900/50 border-zinc-800 hover:border-zinc-700'
                  }`}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontSize: '0.65rem', fontWeight: 800, color: '#a1a1aa' }} className="text-2xs font-extrabold text-zinc-400">
                      {preset.badge}
                    </span>
                    <span
                      style={{
                        fontSize: '0.65rem',
                        fontWeight: 800,
                        padding: '2px 8px',
                        borderRadius: 12,
                        backgroundColor: isApproved ? '#064e3b' : '#4c0519',
                        color: isApproved ? '#6ee7b7' : '#fecdd3',
                        border: `1px solid ${isApproved ? '#059669' : '#9f1239'}`,
                      }}
                      className={`text-2xs font-bold px-2 py-0.5 rounded-full ${
                        isApproved ? 'bg-emerald-950 text-emerald-300 border border-emerald-700' : 'bg-rose-950 text-rose-300 border border-rose-800'
                      }`}
                    >
                      EXPECT: {preset.expected}
                    </span>
                  </div>

                  <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#fafafa', marginBottom: 4 }} className="text-xs font-bold text-zinc-100">
                    {preset.name}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#a1a1aa', lineHeight: 1.4 }} className="text-xs text-zinc-400">
                    {preset.description}
                  </div>
                </div>
              );
            })}
          </div>

          {/* JSON-RPC Editor & Dispatch Terminal */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
              gap: 16,
            }}
            className="grid grid-cols-1 lg:grid-cols-2 gap-4"
          >
            {/* Left: JSON Payload Editor */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#d4d4d8', textTransform: 'uppercase' }} className="text-xs font-bold text-zinc-300 uppercase">
                  JSON-RPC 2.0 Inbound Proposal Body
                </label>
                <button
                  type="button"
                  onClick={() => {
                    const preset = PRESETS.find((p) => p.id === selectedPresetId);
                    if (preset) setCustomRpcJson(JSON.stringify(preset.fixture.rpcRequest, null, 2));
                  }}
                  style={{
                    fontSize: '0.7rem',
                    color: '#a1a1aa',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                  }}
                  className="text-2xs text-zinc-400 hover:text-zinc-200 underline cursor-pointer"
                >
                  Reset to Fixture
                </button>
              </div>

              <textarea
                value={customRpcJson}
                onChange={(e) => setCustomRpcJson(e.target.value)}
                rows={13}
                style={{
                  width: '100%',
                  fontFamily: 'monospace',
                  fontSize: '0.75rem',
                  backgroundColor: '#09090b',
                  color: '#e4e4e7',
                  border: '1px solid #3f3f46',
                  borderRadius: 6,
                  padding: 10,
                  boxSizing: 'border-box',
                  outline: 'none',
                  resize: 'vertical',
                }}
                className="w-full font-mono text-xs bg-zinc-950 text-zinc-200 border border-zinc-700 rounded-md p-3 focus:border-emerald-500"
              />

              <div style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center' }}>
                <button
                  type="button"
                  disabled={isDispatching}
                  onClick={handleDispatch}
                  style={{
                    backgroundColor: '#059669',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: 6,
                    padding: '10px 20px',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    cursor: isDispatching ? 'not-allowed' : 'pointer',
                    opacity: isDispatching ? 0.7 : 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-md text-sm font-bold flex items-center gap-2 cursor-pointer shadow-md disabled:opacity-50"
                >
                  {isDispatching ? (
                    <>
                      <span className="animate-spin">&diams;</span>
                      Proxying to Gateway (:3001)...
                    </>
                  ) : (
                    <>
                      <span>&rarr;</span>
                      Dispatch to Gateway (Port 3001)
                    </>
                  )}
                </button>

                <span style={{ fontSize: '0.72rem', color: '#71717a' }} className="text-xs text-zinc-500">
                  Tool: <code>propose_resolver</code> &bull; Non-mutating proxy
                </span>
              </div>

              {dispatchError && (
                <div
                  style={{
                    marginTop: 10,
                    padding: 10,
                    backgroundColor: '#450a0a',
                    border: '1px solid #b91c1c',
                    color: '#fca5a5',
                    borderRadius: 6,
                    fontSize: '0.75rem',
                  }}
                  className="mt-3 p-3 bg-rose-950/80 border border-rose-800 text-rose-300 rounded text-xs"
                >
                  <strong>Dispatch Error:</strong> {dispatchError}
                </div>
              )}
            </div>

            {/* Right: Telemetry & Verdict Console */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#d4d4d8', textTransform: 'uppercase' }} className="text-xs font-bold text-zinc-300 uppercase">
                  Gateway Interception & Mathematical Verdict
                </label>
                {lastDispatchResponse && (
                  <span
                    style={{
                      fontSize: '0.7rem',
                      fontWeight: 800,
                      padding: '2px 8px',
                      borderRadius: 12,
                      backgroundColor: evaluatedVerdict === 'APPROVED' ? '#064e3b' : '#4c0519',
                      color: evaluatedVerdict === 'APPROVED' ? '#6ee7b7' : '#fecdd3',
                      border: `1px solid ${evaluatedVerdict === 'APPROVED' ? '#059669' : '#be123c'}`,
                    }}
                    className={`text-2xs font-bold px-2 py-0.5 rounded-full ${
                      evaluatedVerdict === 'APPROVED' ? 'bg-emerald-950 text-emerald-300 border border-emerald-700' : 'bg-rose-950 text-rose-300 border border-rose-800'
                    }`}
                  >
                    VERDICT: {evaluatedVerdict}
                  </span>
                )}
              </div>

              <div
                style={{
                  height: 290,
                  backgroundColor: '#09090b',
                  border: '1px solid #3f3f46',
                  borderRadius: 6,
                  padding: 12,
                  overflow: 'auto',
                  fontFamily: 'monospace',
                  fontSize: '0.72rem',
                }}
                className="h-72 bg-zinc-950 border border-zinc-700 rounded-md p-3 overflow-auto font-mono text-2xs"
              >
                {!lastDispatchResponse ? (
                  <div style={{ color: '#52525b', paddingTop: 60, textAlign: 'center' }} className="text-zinc-600 text-center py-16">
                    <div>[Gateway Telemetry Standby]</div>
                    <div style={{ marginTop: 6, fontSize: '0.7rem' }}>
                      Click &ldquo;Dispatch to Gateway (Port 3001)&rdquo; above to send proposal through proxy.
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={{ color: '#a1a1aa', marginBottom: 8 }}>
                      <strong>HTTP Status:</strong> {lastDispatchResponse.httpStatus} &bull; <strong>Verdict:</strong>{' '}
                      <span style={{ color: evaluatedVerdict === 'APPROVED' ? '#34d399' : '#f43f5e', fontWeight: 800 }}>
                        {evaluatedVerdict}
                      </span>
                    </div>
                    <pre style={{ margin: 0, color: '#e4e4e7', whiteSpace: 'pre-wrap' }}>
                      {JSON.stringify(lastDispatchResponse.body, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 3: LIVE AUDIT STREAM */}
        <section
          style={{
            backgroundColor: '#121215',
            border: '1px solid #27272a',
            borderRadius: 12,
            padding: 20,
          }}
          className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5"
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    fontSize: '0.65rem',
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    backgroundColor: '#14532d',
                    color: '#bbf7d0',
                    padding: '2px 8px',
                    borderRadius: 4,
                    border: '1px solid #16a34a',
                  }}
                  className="text-2xs font-bold tracking-wider uppercase bg-emerald-950 text-emerald-300 px-2 py-0.5 rounded border border-emerald-800"
                >
                  Layer 3 &bull; Proof & Ledger
                </span>
                <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: '#fafafa' }} className="text-lg font-bold text-zinc-100">
                  Live Audit Stream &bull; <code>agent_audit_logs</code>
                </h2>
              </div>
              <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: '#71717a' }} className="text-xs text-zinc-500">
                Immutable PostgreSQL ledger written by MCP Gateway proxy on port <code>3001</code>.
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {dbStatus === 'UNAVAILABLE' && (
                <span
                  style={{
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    padding: '3px 8px',
                    borderRadius: 4,
                    backgroundColor: '#451a03',
                    color: '#fde68a',
                    border: '1px solid #b45309',
                  }}
                  className="text-2xs font-bold px-2 py-1 rounded bg-amber-950 text-amber-300 border border-amber-800"
                >
                  Postgres Offline (Using Fallback View)
                </span>
              )}

              <button
                type="button"
                onClick={() => setPollingActive(!pollingActive)}
                style={{
                  padding: '4px 10px',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  backgroundColor: '#18181b',
                  color: '#d4d4d8',
                  border: '1px solid #3f3f46',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
                className="px-2.5 py-1 text-xs font-semibold bg-zinc-900 text-zinc-300 border border-zinc-700 rounded hover:bg-zinc-800 cursor-pointer"
              >
                {pollingActive ? 'Pause Polling' : 'Resume Polling'}
              </button>

              <button
                type="button"
                onClick={fetchAuditLogs}
                style={{
                  padding: '4px 10px',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  backgroundColor: '#18181b',
                  color: '#d4d4d8',
                  border: '1px solid #3f3f46',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
                className="px-2.5 py-1 text-xs font-semibold bg-zinc-900 text-zinc-300 border border-zinc-700 rounded hover:bg-zinc-800 cursor-pointer"
              >
                Refresh Now
              </button>

              <span style={{ fontSize: '0.7rem', color: '#71717a' }} className="text-2xs text-zinc-500">
                Last checked: {lastPollTime || 'Connecting...'}
              </span>
            </div>
          </div>

          {/* Audit Logs Table */}
          {auditLogs.length === 0 ? (
            <div
              style={{
                padding: '48px 20px',
                textAlign: 'center',
                backgroundColor: '#09090b',
                borderRadius: 8,
                border: '1px solid #27272a',
                color: '#71717a',
              }}
              className="py-12 px-4 text-center bg-zinc-950 rounded-lg border border-zinc-800 text-zinc-500"
            >
              <div style={{ fontSize: '2rem', marginBottom: 8 }}>&shield;</div>
              <h3 style={{ margin: '0 0 4px 0', fontSize: '1rem', color: '#d4d4d8', fontWeight: 600 }} className="text-sm font-semibold text-zinc-300">
                No Interceptions Recorded in Postgres Yet
              </h3>
              <p style={{ margin: 0, fontSize: '0.75rem', maxWidth: 480, marginInline: 'auto' }} className="text-xs text-zinc-500 max-w-md mx-auto">
                Trigger any preset scenario above to dispatch an autonomous agent request. The Gateway on port <code>3001</code> will log the initial <code>INTERCEPTED</code> state and mathematical verdict here.
              </p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  textAlign: 'left',
                  fontSize: '0.78rem',
                }}
                className="w-full border-collapse text-left text-xs"
              >
                <thead>
                  <tr
                    style={{
                      borderBottom: '1px solid #27272a',
                      color: '#a1a1aa',
                      backgroundColor: '#09090b',
                    }}
                    className="border-b border-zinc-800 text-zinc-400 bg-zinc-950 font-semibold"
                  >
                    <th style={{ padding: '10px 14px' }}>Verdict Status</th>
                    <th style={{ padding: '10px 14px' }}>Tool / Mutation</th>
                    <th style={{ padding: '10px 14px' }}>Source State &rarr; Event</th>
                    <th style={{ padding: '10px 14px' }}>Agent Persona</th>
                    <th style={{ padding: '10px 14px' }}>Timestamp</th>
                    <th style={{ padding: '10px 14px', textAlign: 'right' }}>Inspection</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.map((log) => {
                    const isApproved = log.status === 'APPROVED';
                    const isRejected = log.status === 'REJECTED';

                    const chipBg = isApproved ? '#064e3b' : isRejected ? '#4c0519' : '#451a03';
                    const chipColor = isApproved ? '#6ee7b7' : isRejected ? '#fecdd3' : '#fde68a';
                    const chipBorder = isApproved ? '#059669' : isRejected ? '#9f1239' : '#b45309';

                    const toolArgs = log.payload?.params?.arguments || log.payload?.params || {};

                    return (
                      <tr
                        key={log.id}
                        style={{
                          borderBottom: '1px solid #18181b',
                          backgroundColor: isRejected ? 'rgba(76, 5, 25, 0.12)' : 'transparent',
                        }}
                        className="border-b border-zinc-900/80 hover:bg-zinc-800/40 transition-colors"
                      >
                        {/* Status Chip */}
                        <td style={{ padding: '12px 14px', verticalAlign: 'middle' }}>
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              fontSize: '0.7rem',
                              fontWeight: 700,
                              padding: '2px 8px',
                              borderRadius: 12,
                              backgroundColor: chipBg,
                              color: chipColor,
                              border: `1px solid ${chipBorder}`,
                            }}
                            className={`inline-flex items-center gap-1 text-2xs font-bold px-2 py-0.5 rounded-full ${
                              isApproved
                                ? 'bg-emerald-950 text-emerald-300 border border-emerald-700'
                                : isRejected
                                ? 'bg-rose-950 text-rose-300 border border-rose-800'
                                : 'bg-amber-950 text-amber-300 border border-amber-800'
                            }`}
                          >
                            <span>{isApproved ? '✓' : isRejected ? '✗' : '⏳'}</span>
                            <span>{log.status}</span>
                          </span>
                        </td>

                        {/* Tool / Mutation */}
                        <td style={{ padding: '12px 14px', verticalAlign: 'middle' }}>
                          <div style={{ fontWeight: 700, color: '#f4f4f5' }} className="font-bold text-zinc-200">
                            {log.toolName}
                          </div>
                          {toolArgs.mutationName && (
                            <div style={{ fontSize: '0.7rem', color: '#71717a' }} className="text-2xs text-zinc-500 font-mono">
                              gql: {toolArgs.mutationName}
                            </div>
                          )}
                        </td>

                        {/* State & Event */}
                        <td style={{ padding: '12px 14px', verticalAlign: 'middle' }}>
                          {toolArgs.sourceState ? (
                            <div style={{ fontSize: '0.72rem', fontFamily: 'monospace' }} className="text-2xs font-mono">
                              <span style={{ color: '#c084fc' }}>{toolArgs.sourceState}</span>
                              <span style={{ color: '#71717a' }}> &rarr; </span>
                              <span style={{ color: '#38bdf8' }}>{toolArgs.event}</span>
                            </div>
                          ) : (
                            <span style={{ color: '#52525b', fontSize: '0.7rem' }}>n/a</span>
                          )}
                        </td>

                        {/* Agent ID */}
                        <td style={{ padding: '12px 14px', verticalAlign: 'middle', fontFamily: 'monospace', fontSize: '0.72rem', color: '#a1a1aa' }}>
                          {log.agentId}
                        </td>

                        {/* Timestamp */}
                        <td style={{ padding: '12px 14px', verticalAlign: 'middle', color: '#71717a', fontSize: '0.72rem' }}>
                          {new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </td>

                        {/* Inspect Action */}
                        <td style={{ padding: '12px 14px', verticalAlign: 'middle', textAlign: 'right' }}>
                          <button
                            type="button"
                            onClick={() => setInspectRecord(log)}
                            style={{
                              padding: '3px 8px',
                              fontSize: '0.7rem',
                              fontWeight: 600,
                              backgroundColor: '#27272a',
                              color: '#e4e4e7',
                              border: '1px solid #3f3f46',
                              borderRadius: 4,
                              cursor: 'pointer',
                            }}
                            className="px-2 py-0.5 text-2xs font-semibold bg-zinc-800 text-zinc-300 border border-zinc-700 rounded hover:bg-zinc-700 cursor-pointer"
                          >
                            Inspect Payload &rarr;
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      {/* INSPECT MODAL / DRAWER */}
      {inspectRecord && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 50,
            padding: 20,
            backdropFilter: 'blur(4px)',
          }}
          className="fixed inset-0 bg-black/80 flex justify-center items-center z-50 p-4 backdrop-blur-sm"
        >
          <div
            style={{
              backgroundColor: '#121215',
              border: '1px solid #3f3f46',
              borderRadius: 12,
              width: '100%',
              maxWidth: 780,
              maxHeight: '90vh',
              overflow: 'auto',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
              padding: 24,
            }}
            className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-3xl max-h-[90vh] overflow-auto shadow-2xl p-6"
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      fontSize: '0.7rem',
                      fontWeight: 800,
                      padding: '2px 8px',
                      borderRadius: 12,
                      backgroundColor: inspectRecord.status === 'APPROVED' ? '#064e3b' : '#4c0519',
                      color: inspectRecord.status === 'APPROVED' ? '#6ee7b7' : '#fecdd3',
                      border: `1px solid ${inspectRecord.status === 'APPROVED' ? '#059669' : '#9f1239'}`,
                    }}
                    className={`text-2xs font-bold px-2 py-0.5 rounded-full ${
                      inspectRecord.status === 'APPROVED' ? 'bg-emerald-950 text-emerald-300 border border-emerald-700' : 'bg-rose-950 text-rose-300 border border-rose-800'
                    }`}
                  >
                    {inspectRecord.status}
                  </span>
                  <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#fafafa' }} className="text-base font-bold text-zinc-100">
                    Interception Audit Detail
                  </h3>
                </div>
                <div style={{ fontSize: '0.72rem', color: '#71717a', marginTop: 4 }} className="text-xs text-zinc-500 font-mono">
                  Log ID: {inspectRecord.id} &bull; Session: {inspectRecord.sessionId}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setInspectRecord(null)}
                style={{
                  backgroundColor: '#27272a',
                  color: '#d4d4d8',
                  border: 'none',
                  borderRadius: 6,
                  padding: '4px 10px',
                  cursor: 'pointer',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                }}
                className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded px-2.5 py-1 text-sm font-bold cursor-pointer"
              >
                &times; Close
              </button>
            </div>

            {/* Modal Content */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Evaluated State Machine Invariants Feedback */}
              {inspectRecord.response && (
                <div>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#a1a1aa', textTransform: 'uppercase', marginBottom: 4 }}>
                    Formal Verifier Response & Feedback:
                  </div>
                  <pre
                    style={{
                      margin: 0,
                      padding: 10,
                      backgroundColor: '#09090b',
                      border: '1px solid #27272a',
                      borderRadius: 6,
                      fontSize: '0.72rem',
                      color: inspectRecord.status === 'APPROVED' ? '#a7f3d0' : '#fecdd3',
                      overflowX: 'auto',
                    }}
                    className="p-3 bg-zinc-950 border border-zinc-800 rounded font-mono text-2xs overflow-auto"
                  >
                    {JSON.stringify(inspectRecord.response, null, 2)}
                  </pre>
                </div>
              )}

              {/* Intercepted JSON-RPC Payload */}
              <div>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#a1a1aa', textTransform: 'uppercase', marginBottom: 4 }}>
                  Raw Intercepted Agent Payload:
                </div>
                <pre
                  style={{
                    margin: 0,
                    padding: 10,
                    backgroundColor: '#09090b',
                    border: '1px solid #27272a',
                    borderRadius: 6,
                    fontSize: '0.72rem',
                    color: '#e4e4e7',
                    overflowX: 'auto',
                    maxHeight: 280,
                  }}
                  className="p-3 bg-zinc-950 border border-zinc-800 rounded font-mono text-2xs overflow-auto max-h-72"
                >
                  {JSON.stringify(inspectRecord.payload, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer
        style={{
          borderTop: '1px solid #27272a',
          marginTop: 40,
          padding: '20px 24px',
          textAlign: 'center',
          fontSize: '0.75rem',
          color: '#52525b',
        }}
        className="border-t border-zinc-800 mt-10 py-5 text-center text-xs text-zinc-600"
      >
        Axioma Architecture Proof-of-Concept &bull; Zero-Trust LLM Governance Flight Simulator &bull; Intercepting Port 3001 &rarr; Port 3000
      </footer>
    </div>
  );
}
