export interface InMemoryAuditLog {
  id: string;
  agentId: string;
  sessionId: string;
  domain?: string;
  toolName: string;
  payload: any;
  response?: any;
  status: 'INTERCEPTED' | 'APPROVED' | 'REJECTED';
  createdAt: string;
}

export const inMemoryAuditLogs: InMemoryAuditLog[] = [
  {
    id: 'demo-log-006',
    agentId: 'agent-fulfillment-worker',
    sessionId: 'session-sim-006-label-print',
    domain: 'fulfillment',
    toolName: 'propose_resolver',
    payload: {
      jsonrpc: '2.0',
      id: 'sim-req-006',
      method: 'tools/call',
      params: {
        name: 'propose_resolver',
        _meta: { agentId: 'agent-fulfillment-worker', sessionId: 'session-sim-006-label-print', domain: 'fulfillment' },
        arguments: {
          domain: 'fulfillment',
          mutationName: 'printShippingLabel',
          sourceState: 'inventory_allocated',
          event: 'PRINT_LABEL',
          payload: { orderId: 'ord_9981', carrier: 'FedEx Express' },
        },
      },
    },
    response: {
      jsonrpc: '2.0',
      id: 'sim-req-006',
      result: {
        isError: false,
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'APPROVED',
              domain: 'fulfillment',
              sourceState: 'inventory_allocated',
              targetState: 'label_printed',
              validatedGuards: ['hasValidCarrier'],
              feedback: "Proposal successfully validated! Legal transition from 'inventory_allocated' to 'label_printed' via 'PRINT_LABEL'.",
            }, null, 2),
          },
        ],
      },
    },
    status: 'APPROVED',
    createdAt: '2026-10-14T20:58:00.000Z',
  },
  {
    id: 'demo-log-005',
    agentId: 'agent-fulfillment-worker',
    sessionId: 'session-sim-005-handoff-allocation',
    domain: 'fulfillment',
    toolName: 'propose_resolver',
    payload: {
      jsonrpc: '2.0',
      id: 'sim-req-005',
      method: 'tools/call',
      params: {
        name: 'propose_resolver',
        _meta: { agentId: 'agent-fulfillment-worker', sessionId: 'session-sim-005-handoff-allocation', domain: 'fulfillment' },
        arguments: {
          domain: 'fulfillment',
          mutationName: 'allocateInventory',
          sourceState: 'unfulfilled',
          event: 'ALLOCATE_INVENTORY',
          payload: { orderId: 'ord_9981', items: [{ sku: 'PROD-A', quantity: 2 }] },
        },
      },
    },
    response: {
      jsonrpc: '2.0',
      id: 'sim-req-005',
      result: {
        isError: false,
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'APPROVED',
              domain: 'fulfillment',
              sourceState: 'unfulfilled',
              targetState: 'inventory_allocated',
              validatedGuards: ['hasOrderId', 'hasItems'],
              feedback: "Proposal successfully validated! Legal transition from 'unfulfilled' to 'inventory_allocated' via 'ALLOCATE_INVENTORY' in domain 'fulfillment'.",
            }, null, 2),
          },
        ],
      },
    },
    status: 'APPROVED',
    createdAt: '2026-10-14T20:55:00.000Z',
  },
  {
    id: 'demo-log-004',
    agentId: 'agent-fulfillment-worker',
    sessionId: 'session-sim-004-cross-domain-violation',
    domain: 'fulfillment',
    toolName: 'propose_resolver',
    payload: {
      jsonrpc: '2.0',
      id: 'sim-req-004',
      method: 'tools/call',
      params: {
        name: 'propose_resolver',
        _meta: { agentId: 'agent-fulfillment-worker', sessionId: 'session-sim-004-cross-domain-violation', domain: 'fulfillment' },
        arguments: {
          domain: 'fulfillment',
          mutationName: 'submitPayment',
          sourceState: 'pending_payment',
          event: 'SUBMIT_PAYMENT',
          payload: { orderId: 'ord_9981', amountCents: 5000 },
        },
      },
    },
    response: {
      jsonrpc: '2.0',
      id: 'sim-req-004',
      result: {
        isError: true,
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'REJECTED',
              domain: 'fulfillment',
              sourceState: 'pending_payment',
              violations: ['DOMAIN_BOUNDARY_VIOLATION'],
              feedback: "Domain boundary violation: Agent operating in domain 'fulfillment' cannot execute checkout operation 'submitPayment'.",
            }, null, 2),
          },
        ],
      },
    },
    status: 'REJECTED',
    createdAt: '2026-10-14T20:50:00.000Z',
  },
  {
    id: 'demo-log-002',
    agentId: 'agent-compliant-checkout-worker',
    sessionId: 'session-sim-002-valid-payment-flow',
    domain: 'checkout',
    toolName: 'propose_resolver',
    payload: {
      jsonrpc: '2.0',
      id: 'sim-req-002',
      method: 'tools/call',
      params: {
        name: 'propose_resolver',
        _meta: { agentId: 'agent-compliant-checkout-worker', sessionId: 'session-sim-002-valid-payment-flow' },
        arguments: {
          mutationName: 'submitPayment',
          sourceState: 'pending_payment',
          event: 'SUBMIT_PAYMENT',
          payload: { orderId: '00000000-0000-0000-0000-000000000001', idempotencyKey: 'idem_valid_tx_20261009_a87f', amountCents: 3956 },
        },
      },
    },
    response: {
      jsonrpc: '2.0',
      id: 'sim-req-002',
      result: {
        isError: false,
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'APPROVED',
              domain: 'checkout',
              sourceState: 'pending_payment',
              targetState: 'payment_processing',
              validatedGuards: ['hasIdempotencyKey', 'validPositiveAmount'],
              feedback: "Proposal successfully validated! Legal transition from 'pending_payment' to 'payment_processing' via 'SUBMIT_PAYMENT'.",
            }, null, 2),
          },
        ],
      },
    },
    status: 'APPROVED',
    createdAt: '2026-10-14T20:45:00.000Z',
  },
  {
    id: 'demo-log-001',
    agentId: 'agent-rogue-discount-exploiter',
    sessionId: 'session-sim-001-empty-cart-exploit',
    domain: 'checkout',
    toolName: 'propose_resolver',
    payload: {
      jsonrpc: '2.0',
      id: 'sim-req-001',
      method: 'tools/call',
      params: {
        name: 'propose_resolver',
        _meta: { agentId: 'agent-rogue-discount-exploiter', sessionId: 'session-sim-001-empty-cart-exploit' },
        arguments: {
          mutationName: 'applyDiscountCode',
          sourceState: 'empty_cart',
          event: 'APPLY_DISCOUNT',
          payload: { orderId: '00000000-0000-0000-0000-000000000001', code: 'ZERO_DAY_99', discountCents: 9900 },
        },
      },
    },
    response: {
      jsonrpc: '2.0',
      id: 'sim-req-001',
      result: {
        isError: true,
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'REJECTED',
              domain: 'checkout',
              sourceState: 'empty_cart',
              violations: ['ILLEGAL_STATE_TRANSITION'],
              feedback: "In state 'empty_cart', triggering 'APPLY_DISCOUNT' is mathematically impossible. The machine forbids this transition.",
            }, null, 2),
          },
        ],
      },
    },
    status: 'REJECTED',
    createdAt: '2026-10-14T20:30:00.000Z',
  },
];

export function recordInMemoryAuditLog(log: InMemoryAuditLog) {
  const existingIndex = inMemoryAuditLogs.findIndex((l) => l.id === log.id);
  if (existingIndex >= 0) {
    inMemoryAuditLogs[existingIndex] = {
      ...inMemoryAuditLogs[existingIndex],
      ...log,
    };
  } else {
    inMemoryAuditLogs.unshift(log);
    if (inMemoryAuditLogs.length > 100) {
      inMemoryAuditLogs.pop();
    }
  }
}

export function getInMemoryAuditLogs(domain?: string, limit = 30): InMemoryAuditLog[] {
  let logs = inMemoryAuditLogs;
  if (domain && domain !== 'all') {
    logs = logs.filter((l) => (l.domain || '').toLowerCase() === domain.toLowerCase());
  }
  return logs.slice(0, limit);
}
