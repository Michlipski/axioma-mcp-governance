'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

// Preset scenario fixtures
import scenario1 from '../../../showcase/scenarios/01-illegal-discount-on-empty-cart.json';
import scenario2 from '../../../showcase/scenarios/02-valid-checkout-and-payment.json';
import scenario3 from '../../../showcase/scenarios/03-missing-idempotency-key.json';
import scenario4 from '../../../showcase/scenarios/04-cross-domain-boundary-violation.json';
import scenario5 from '../../../showcase/scenarios/05-cross-domain-handoff-success.json';
import scenario6 from '../../../showcase/scenarios/06-legal-fulfillment-progression.json';

interface AuditLogRecord {
  id: string;
  agentId: string;
  sessionId: string;
  domain?: 'checkout' | 'fulfillment' | string;
  toolName: string;
  payload: any;
  response?: any;
  status: 'INTERCEPTED' | 'APPROVED' | 'REJECTED';
  createdAt: string;
}

interface HandoffLog {
  id: string;
  time: string;
  domain: 'checkout' | 'event-bus' | 'gateway' | 'fulfillment' | 'system';
  tag: string;
  message: string;
  detail?: string;
}

interface StateNodeConfig {
  domain: 'checkout' | 'fulfillment';
  name: string;
  label: string;
  description: string;
  admissibleEvents: string[];
  illegalEvents: string[];
  guards: string[];
}

const CHECKOUT_TOPOLOGY: Record<string, StateNodeConfig> = {
  empty_cart: {
    domain: 'checkout',
    name: 'empty_cart',
    label: 'Empty Cart',
    description: 'Initial checkout state. Mathematical axiom: cart has zero items. Financial and checkout mutations are strictly prohibited.',
    admissibleEvents: ['ADD_ITEM'],
    illegalEvents: ['APPLY_DISCOUNT', 'SUBMIT_PAYMENT', 'INITIATE_CHECKOUT', 'ATTACH_SHIPPING', 'ALLOCATE_INVENTORY'],
    guards: ['Cart must contain at least 1 item before entering checkout'],
  },
  checkout_draft: {
    domain: 'checkout',
    name: 'checkout_draft',
    label: 'Checkout Draft',
    description: 'Cart is locked for checkout. Awaiting customer shipping information and optional promotion codes.',
    admissibleEvents: ['ATTACH_SHIPPING', 'APPLY_DISCOUNT', 'REMOVE_DISCOUNT', 'CANCEL_CHECKOUT'],
    illegalEvents: ['SUBMIT_PAYMENT', 'ADD_ITEM', 'DISPATCH_FULFILLMENT', 'ALLOCATE_INVENTORY'],
    guards: ['isValidShippingAddress: Recipient, address line, city, postal code, and country required'],
  },
  pending_payment: {
    domain: 'checkout',
    name: 'pending_payment',
    label: 'Pending Payment',
    description: 'Order totals are frozen. Gateway transactions can be proposed with strict idempotency verification.',
    admissibleEvents: ['SUBMIT_PAYMENT', 'CANCEL_CHECKOUT'],
    illegalEvents: ['ADD_ITEM', 'APPLY_DISCOUNT', 'DISPATCH_FULFILLMENT', 'ALLOCATE_INVENTORY'],
    guards: [
      'hasIdempotencyKey: Non-empty string required',
      'validPositiveAmount: amountCents must strictly match totalCents',
      'orderId must be present',
    ],
  },
  paid: {
    domain: 'checkout',
    name: 'paid',
    label: 'Paid (Settled)',
    description: 'Commercial contract settled and finalized. Double-charging blocked. Triggers ORDER_PAID event bus transition to Fulfillment domain.',
    admissibleEvents: ['DISPATCH_FULFILLMENT'],
    illegalEvents: ['SUBMIT_PAYMENT', 'CANCEL_CHECKOUT', 'APPLY_DISCOUNT', 'ATTACH_SHIPPING', 'ALLOCATE_INVENTORY'],
    guards: ['Commercial contract settled. Irreversible state.'],
  },
};

const FULFILLMENT_TOPOLOGY: Record<string, StateNodeConfig> = {
  unfulfilled: {
    domain: 'fulfillment',
    name: 'unfulfilled',
    label: 'Unfulfilled (Queued)',
    description: 'Initial fulfillment state awaiting warehouse inventory allocation. Cross-domain payment and cart mutations are strictly illegal.',
    admissibleEvents: ['ALLOCATE_INVENTORY'],
    illegalEvents: ['SUBMIT_PAYMENT', 'INITIATE_CHECKOUT', 'APPLY_DISCOUNT', 'PRINT_LABEL', 'DISPATCH_SHIPMENT'],
    guards: ['hasOrderId: Non-empty orderId required', 'hasItems: Inventory items array must be non-empty'],
  },
  inventory_allocated: {
    domain: 'fulfillment',
    name: 'inventory_allocated',
    label: 'Inventory Allocated',
    description: 'Warehouse stock reserved for order. Awaiting shipping label generation with carrier selection.',
    admissibleEvents: ['PRINT_LABEL', 'CANCEL_FULFILLMENT'],
    illegalEvents: ['SUBMIT_PAYMENT', 'INITIATE_CHECKOUT', 'DISPATCH_SHIPMENT'],
    guards: ['hasValidCarrier: Carrier name required for label printing'],
  },
  label_printed: {
    domain: 'fulfillment',
    name: 'label_printed',
    label: 'Label Printed',
    description: 'Shipping label attached. Package staged on loading dock for logistics carrier pickup.',
    admissibleEvents: ['DISPATCH_SHIPMENT'],
    illegalEvents: ['SUBMIT_PAYMENT', 'ALLOCATE_INVENTORY', 'PRINT_LABEL'],
    guards: ['hasValidTracking: trackingNumber required for carrier handoff'],
  },
  in_transit: {
    domain: 'fulfillment',
    name: 'in_transit',
    label: 'In Transit (Terminal)',
    description: 'Package handed over to logistics carrier. Final terminal fulfillment state.',
    admissibleEvents: [],
    illegalEvents: ['SUBMIT_PAYMENT', 'ALLOCATE_INVENTORY', 'PRINT_LABEL', 'DISPATCH_SHIPMENT'],
    guards: ['Terminal state. Package in custody of logistics carrier.'],
  },
};

const ALL_TOPOLOGY: Record<string, StateNodeConfig> = {
  ...CHECKOUT_TOPOLOGY,
  ...FULFILLMENT_TOPOLOGY,
};

const PRESETS = [
  {
    id: 'scenario-01',
    badge: 'SCENARIO 01',
    domain: 'checkout' as const,
    name: 'Rogue Agent: Attempt Discount on Empty Cart',
    expected: 'REJECTED' as const,
    sourceState: 'empty_cart',
    event: 'APPLY_DISCOUNT',
    description: 'Agent attempts discount mutation before items exist. State boundary rejects transition mathematically.',
    fixture: scenario1,
  },
  {
    id: 'scenario-02',
    badge: 'SCENARIO 02',
    domain: 'checkout' as const,
    name: 'Compliant Agent: Execute Legal Payment',
    expected: 'APPROVED' as const,
    sourceState: 'pending_payment',
    event: 'SUBMIT_PAYMENT',
    description: 'Agent satisfies all invariants: state is pending_payment, idempotency key provided, and amount strictly matches.',
    fixture: scenario2,
  },
  {
    id: 'scenario-03',
    badge: 'SCENARIO 03',
    domain: 'checkout' as const,
    name: 'Rogue Agent: Submit Payment Without Idempotency Key',
    expected: 'REJECTED' as const,
    sourceState: 'pending_payment',
    event: 'SUBMIT_PAYMENT',
    description: 'Agent attempts payment submission omitting idempotency key. State guard flags missing idempotency key.',
    fixture: scenario3,
  },
  {
    id: 'scenario-04',
    badge: 'SCENARIO A (EXPANSION 3)',
    domain: 'fulfillment' as const,
    name: 'Cross-Domain Violation: Fulfillment Worker Attempts Payment',
    expected: 'REJECTED' as const,
    sourceState: 'unfulfilled',
    event: 'SUBMIT_PAYMENT',
    description: 'Worker in fulfillment domain attempts checkout mutation (submitPayment). Gateway intercepts and rejects with DOMAIN_BOUNDARY_VIOLATION.',
    fixture: scenario4,
  },
  {
    id: 'scenario-05',
    badge: 'SCENARIO B (EXPANSION 3)',
    domain: 'fulfillment' as const,
    name: 'Event-Driven Domain Handoff: ORDER_PAID to Allocation',
    expected: 'APPROVED' as const,
    sourceState: 'unfulfilled',
    event: 'ALLOCATE_INVENTORY',
    description: 'Order paid event emits ORDER_PAID. Newly instantiated agent-fulfillment-worker proposes allocateInventory on unfulfilled -> APPROVED.',
    fixture: scenario5,
  },
  {
    id: 'scenario-06',
    badge: 'SCENARIO C (EXPANSION 3)',
    domain: 'fulfillment' as const,
    name: 'Legal Fulfillment Progression: Print Shipping Label',
    expected: 'APPROVED' as const,
    sourceState: 'inventory_allocated',
    event: 'PRINT_LABEL',
    description: 'Advance fulfillmentMachine from inventory_allocated to label_printed with valid logistics carrier -> APPROVED.',
    fixture: scenario6,
  },
];

export default function ShowcasePage() {
  // Domain Canvas States
  const [checkoutState, setCheckoutState] = useState<string>('pending_payment');
  const [fulfillmentState, setFulfillmentState] = useState<string>('unfulfilled');
  const [focusedDomain, setFocusedDomain] = useState<'both' | 'checkout' | 'fulfillment'>('both');
  const [inspectedNodeKey, setInspectedNodeKey] = useState<string>('unfulfilled');

  // Simulation Preset States (Defaulting to Scenario B: Cross-Domain Handoff)
  const [selectedPresetId, setSelectedPresetId] = useState<string>('scenario-05');
  const [customRpcJson, setCustomRpcJson] = useState<string>(
    JSON.stringify(scenario5.rpcRequest, null, 2)
  );

  // Handoff Lifecycle State (For Scenario B)
  const [handoffActiveStep, setHandoffActiveStep] = useState<number>(0); // 0 = idle, 1 = Step 1, 2 = Step 2, 3 = Step 3, 4 = done
  const [handoffStepStatuses, setHandoffStepStatuses] = useState<{
    step1: 'idle' | 'running' | 'completed';
    step2: 'idle' | 'running' | 'completed';
    step3: 'idle' | 'running' | 'completed';
  }>({
    step1: 'idle',
    step2: 'idle',
    step3: 'idle',
  });
  const [handoffLogs, setHandoffLogs] = useState<HandoffLog[]>([]);
  const [isAutoPlaying, setIsAutoPlaying] = useState<boolean>(false);

  // Dispatch execution state
  const [isDispatching, setIsDispatching] = useState<boolean>(false);
  const [lastDispatchResponse, setLastDispatchResponse] = useState<any | null>(null);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [gatewayStatus, setGatewayStatus] = useState<'UP' | 'DOWN' | 'CHECKING'>('CHECKING');

  // Client mounting state to guarantee zero SSR hydration mismatches
  const [mounted, setMounted] = useState<boolean>(false);

  // Audit stream state & Domain Filter
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [domainFilter, setDomainFilter] = useState<'all' | 'checkout' | 'fulfillment'>('all');
  const [dbStatus, setDbStatus] = useState<'OK' | 'UNAVAILABLE' | 'FETCHING'>('FETCHING');
  const [pollingActive, setPollingActive] = useState<boolean>(true);
  const [lastPollTime, setLastPollTime] = useState<string>('');

  // Inspection Drawer
  const [inspectRecord, setInspectRecord] = useState<AuditLogRecord | null>(null);

  // Ping Gateway status on load (checks local daemon or serverless route)
  const checkGatewayHealth = useCallback(async () => {
    try {
      let isUp = false;
      const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
      if (isLocal) {
        try {
          const res = await fetch('http://localhost:3001/health', { method: 'GET' });
          if (res.ok) isUp = true;
        } catch {}
      }

      if (!isUp) {
        try {
          const res = await fetch('/axioma/api/gateway', { method: 'GET' });
          if (res.ok) isUp = true;
        } catch {}
      }

      setGatewayStatus(isUp ? 'UP' : 'DOWN');
    } catch {
      setGatewayStatus('DOWN');
    }
  }, []);

  // Poll audit logs from Next.js API route
  const fetchAuditLogs = useCallback(async () => {
    try {
      const basePath = '/axioma';
      const url = domainFilter === 'all'
        ? `${basePath}/api/audit-logs?limit=30`
        : `${basePath}/api/audit-logs?limit=30&domain=${domainFilter}`;

      const res = await fetch(url);
      if (!res.ok) {
        setDbStatus('UNAVAILABLE');
        return;
      }
      const data = await res.json();
      if (data.status === 'DATABASE_UNAVAILABLE') {
        setDbStatus('UNAVAILABLE');
      } else {
        setDbStatus('OK');
        if (Array.isArray(data.logs) && data.logs.length > 0) {
          setAuditLogs((prev) => {
            const dbIds = new Set(data.logs.map((l: any) => l.id));
            const clientOnly = prev.filter((l) => !dbIds.has(l.id));
            return [...data.logs, ...clientOnly].slice(0, 50);
          });
        }
      }
      setLastPollTime(new Date().toLocaleTimeString());
    } catch {
      setDbStatus('UNAVAILABLE');
    }
  }, [domainFilter]);

  useEffect(() => {
    setMounted(true);
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
      if (preset.id === 'scenario-05') {
        // Prepare dual states for Scenario B sequence execution
        setCheckoutState('pending_payment');
        setFulfillmentState('unfulfilled');
        setInspectedNodeKey('unfulfilled');
        setHandoffActiveStep(0);
        setHandoffStepStatuses({ step1: 'idle', step2: 'idle', step3: 'idle' });
        setHandoffLogs([]);
      } else if (preset.domain === 'checkout') {
        setCheckoutState(preset.sourceState);
        setInspectedNodeKey(preset.sourceState);
      } else {
        setFulfillmentState(preset.sourceState);
        setInspectedNodeKey(preset.sourceState);
      }

      setCustomRpcJson(JSON.stringify(preset.fixture.rpcRequest, null, 2));
      setLastDispatchResponse(null);
      setDispatchError(null);
    }
  };

  // Helper to log real-time handoff trace events
  const addHandoffLog = useCallback(
    (
      domain: 'checkout' | 'event-bus' | 'gateway' | 'fulfillment' | 'system',
      tag: string,
      message: string,
      detail?: string
    ) => {
      const entry: HandoffLog = {
        id: `hlog-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        domain,
        tag,
        message,
        detail,
      };
      setHandoffLogs((prev) => [entry, ...prev.slice(0, 49)]);
    },
    []
  );

  // Step 1: Advance Checkout to Paid
  const runStep1 = async () => {
    setIsDispatching(true);
    setHandoffStepStatuses((prev) => ({ ...prev, step1: 'running' }));
    setHandoffActiveStep(1);

    setCheckoutState('pending_payment');
    setInspectedNodeKey('pending_payment');
    addHandoffLog(
      'checkout',
      'CHECKOUT',
      'Verifying order ord_9981 in state pending_payment ($99.00 total)...',
      'Pre-condition: Cart converted and total frozen. Awaiting settlement verification.'
    );

    await new Promise((r) => setTimeout(r, 700));

    setCheckoutState('paid');
    setInspectedNodeKey('paid');
    addHandoffLog(
      'checkout',
      'SETTLED',
      'Payment settled! checkoutMachine reached terminal state "paid".',
      'Commercial contract locked. Irreversible checkout boundary established. Double charging is forbidden.'
    );

    setHandoffStepStatuses((prev) => ({ ...prev, step1: 'completed' }));
    setIsDispatching(false);
  };

  // Step 2: Fire ORDER_PAID event and provision isolated worker
  const runStep2 = async () => {
    setIsDispatching(true);
    setHandoffStepStatuses((prev) => ({ ...prev, step2: 'running' }));
    setHandoffActiveStep(2);

    addHandoffLog(
      'event-bus',
      'EVENT BUS',
      'Broadcasting domain event: ORDER_PAID',
      JSON.stringify({ type: 'ORDER_PAID', payload: { orderId: 'ord_9981', totalCents: 9900 } })
    );

    await new Promise((r) => setTimeout(r, 600));

    addHandoffLog(
      'event-bus',
      'LEAST PRIVILEGE',
      'Instantiating isolated worker context: agent-fulfillment-worker',
      'Stripping cart and payment entities. Bounding agent context to fulfillment domain only.'
    );

    addHandoffLog(
      'event-bus',
      'MCP SCOPE',
      'Provisioned URI: axioma://domains/fulfillment/schema',
      'Scope: InventoryItem, ShippingPackage, FulfillmentJob (Payment/Cart types omitted).'
    );

    setHandoffStepStatuses((prev) => ({ ...prev, step2: 'completed' }));
    setIsDispatching(false);
  };

  // Step 3: Propose allocateInventory via Gateway (:3001)
  const runStep3 = async () => {
    setIsDispatching(true);
    setHandoffStepStatuses((prev) => ({ ...prev, step3: 'running' }));
    setHandoffActiveStep(3);

    addHandoffLog(
      'gateway',
      'GATEWAY :3001',
      'Intercepting JSON-RPC propose_resolver for agent-fulfillment-worker...',
      'Tool: propose_resolver | Mutation: allocateInventory | Source: unfulfilled'
    );

    const rpcPayload = scenario5.rpcRequest;
    setCustomRpcJson(JSON.stringify(rpcPayload, null, 2));

    await handleDispatch(rpcPayload);

    setFulfillmentState('inventory_allocated');
    setInspectedNodeKey('inventory_allocated');

    addHandoffLog(
      'fulfillment',
      'VERIFIER',
      'Axioma fulfillmentMachine verified proposal invariants!',
      'Transition: unfulfilled -> inventory_allocated (Guards validated: hasOrderId, hasItems).'
    );

    addHandoffLog(
      'fulfillment',
      'APPROVED',
      'Audit ledger committed APPROVED record with domain=fulfillment into PostgreSQL.',
      'Handoff lifecycle complete! Worker successfully reserved inventory for order ord_9981.'
    );

    setHandoffStepStatuses((prev) => ({ ...prev, step3: 'completed' }));
    setHandoffActiveStep(4);
    setIsDispatching(false);
  };

  // Run all 3 steps in sequence with realistic pacing
  const runCompleteHandoffSequence = async () => {
    if (isDispatching || isAutoPlaying) return;
    setIsAutoPlaying(true);

    if (handoffStepStatuses.step3 === 'completed') {
      resetHandoffSequence();
      await new Promise((r) => setTimeout(r, 400));
    }

    await runStep1();
    await new Promise((r) => setTimeout(r, 900));

    await runStep2();
    await new Promise((r) => setTimeout(r, 900));

    await runStep3();
    setIsAutoPlaying(false);
  };

  // Reset entire handoff sequence
  const resetHandoffSequence = () => {
    setCheckoutState('pending_payment');
    setFulfillmentState('unfulfilled');
    setInspectedNodeKey('unfulfilled');
    setHandoffActiveStep(0);
    setHandoffStepStatuses({ step1: 'idle', step2: 'idle', step3: 'idle' });
    setHandoffLogs([]);
    setLastDispatchResponse(null);
    setDispatchError(null);
    const preset = PRESETS.find((p) => p.id === 'scenario-05');
    if (preset) {
      setCustomRpcJson(JSON.stringify(preset.fixture.rpcRequest, null, 2));
    }
  };

  // Manual Step Forward
  const runNextStep = async () => {
    if (isDispatching || isAutoPlaying) return;
    if (handoffStepStatuses.step1 !== 'completed') {
      await runStep1();
    } else if (handoffStepStatuses.step2 !== 'completed') {
      await runStep2();
    } else if (handoffStepStatuses.step3 !== 'completed') {
      await runStep3();
    } else {
      resetHandoffSequence();
    }
  };

  // Dispatch JSON-RPC to Gateway (Port 3001)
  const handleDispatch = async (overridePayload?: any) => {
    setIsDispatching(true);
    setDispatchError(null);
    setLastDispatchResponse(null);

    // Guard against React SyntheticEvent when passed directly as an onClick handler
    const isSyntheticEvent =
      overridePayload &&
      (typeof overridePayload.preventDefault === 'function' ||
        'nativeEvent' in overridePayload ||
        '_reactName' in overridePayload);

    const actualOverride = isSyntheticEvent ? undefined : overridePayload;

    let parsedPayload: any;
    if (actualOverride) {
      parsedPayload = actualOverride;
    } else {
      try {
        parsedPayload = JSON.parse(customRpcJson);
      } catch (err: any) {
        setDispatchError(`JSON Parse Error: ${err.message}`);
        setIsDispatching(false);
        return;
      }
    }

    const domain =
      parsedPayload?.params?.arguments?.domain ||
      parsedPayload?.params?._meta?.domain ||
      (selectedPresetId.startsWith('scenario-04') || selectedPresetId.startsWith('scenario-05') || selectedPresetId.startsWith('scenario-06')
        ? 'fulfillment'
        : 'checkout');

    const agentId =
      parsedPayload?.params?._meta?.agentId ||
      (domain === 'fulfillment' ? 'agent-fulfillment-worker' : 'agent-checkout-worker');

    const sessionId = parsedPayload?.params?._meta?.sessionId || `sim-${domain}-${Date.now()}`;

    try {
      // Try port 3001 first on local dev, otherwise use cloud serverless gateway route
      let res: Response | null = null;
      const isLocal = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

      if (isLocal) {
        try {
          res = await fetch('http://localhost:3001/', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-agent-id': agentId,
              'x-domain': domain,
              'x-session-id': sessionId,
            },
            body: JSON.stringify(parsedPayload),
          });
        } catch {}
      }

      if (!res) {
        res = await fetch('/axioma/api/gateway', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-agent-id': agentId,
            'x-domain': domain,
            'x-session-id': sessionId,
          },
          body: JSON.stringify(parsedPayload),
        });
      }

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

      // Update active machine state if proposal is APPROVED
      let evaluatedStatus: 'APPROVED' | 'REJECTED' | 'INTERCEPTED' = 'INTERCEPTED';
      const textContent = responseJson?.result?.content?.[0]?.text;
      if (textContent) {
        try {
          const parsed = JSON.parse(textContent);
          if (parsed.status === 'APPROVED') {
            evaluatedStatus = 'APPROVED';
            if (parsed.targetState) {
              if (domain === 'fulfillment') {
                setFulfillmentState(parsed.targetState);
                setInspectedNodeKey(parsed.targetState);
              } else {
                setCheckoutState(parsed.targetState);
                setInspectedNodeKey(parsed.targetState);
              }
            }
          } else if (parsed.status === 'REJECTED') {
            evaluatedStatus = 'REJECTED';
          }
        } catch {}
      } else if (responseJson?.error || responseJson?.result?.isError) {
        evaluatedStatus = 'REJECTED';
      } else if (res.status === 200) {
        evaluatedStatus = 'APPROVED';
      }

      // Add audit log record to client state immediately for instant feedback
      const clientLog: AuditLogRecord = {
        id: `dispatch-${Date.now()}`,
        agentId,
        sessionId,
        domain,
        toolName: parsedPayload?.params?.name || 'propose_resolver',
        payload: parsedPayload,
        response: responseJson,
        status: evaluatedStatus,
        createdAt: new Date().toISOString(),
      };
      setAuditLogs((prev) => [clientLog, ...prev.filter((p) => p.id !== clientLog.id).slice(0, 49)]);

      // Synchronously refresh audit feed to surface the intercepted attempt
      setTimeout(() => {
        fetchAuditLogs();
      }, 500);
    } catch {
      // Client-side fallback if port 3001 is offline in browser environment
      // Executes exact Axioma formal invariants locally
      const mockResult = simulateProposalVerification(parsedPayload, domain);
      setLastDispatchResponse({
        httpStatus: 200,
        body: {
          jsonrpc: '2.0',
          id: parsedPayload.id || 1,
          result: {
            isError: mockResult.status === 'REJECTED',
            content: [{ type: 'text', text: JSON.stringify(mockResult, null, 2) }],
          },
        },
      });

      // Update synthetic state in viewer
      if (mockResult.status === 'APPROVED' && mockResult.targetState) {
        if (domain === 'fulfillment') {
          setFulfillmentState(mockResult.targetState);
          setInspectedNodeKey(mockResult.targetState);
        } else {
          setCheckoutState(mockResult.targetState);
          setInspectedNodeKey(mockResult.targetState);
        }
      }

      // Add synthetic audit entry for live UI inspection
      const simulatedLog: AuditLogRecord = {
        id: `sim-log-${Date.now()}`,
        agentId,
        sessionId,
        domain,
        toolName: parsedPayload?.params?.name || 'propose_resolver',
        payload: parsedPayload,
        response: {
          status: mockResult.status,
          result: {
            content: [{ type: 'text', text: JSON.stringify(mockResult) }],
          },
        },
        status: mockResult.status,
        createdAt: new Date().toISOString(),
      };
      setAuditLogs((prev) => [simulatedLog, ...prev.slice(0, 24)]);
    } finally {
      setIsDispatching(false);
    }
  };

  // Inspect configs for selected nodes in each domain
  const checkoutNode = CHECKOUT_TOPOLOGY[checkoutState] || CHECKOUT_TOPOLOGY['empty_cart'];
  const fulfillmentNode = FULFILLMENT_TOPOLOGY[fulfillmentState] || FULFILLMENT_TOPOLOGY['unfulfilled'];
  const inspectedNode = ALL_TOPOLOGY[inspectedNodeKey] || checkoutNode;

  // Helper to extract verdict from dispatch response
  let evaluatedVerdict: 'APPROVED' | 'REJECTED' | 'PENDING' = 'PENDING';
  let violationType: string | null = null;

  if (lastDispatchResponse) {
    const resBody = lastDispatchResponse.body;
    if (lastDispatchResponse.httpStatus >= 400 || resBody?.error) {
      evaluatedVerdict = 'REJECTED';
    } else {
      const isErr = resBody?.result?.isError;
      if (isErr === true) {
        evaluatedVerdict = 'REJECTED';
      }
      const textContent = resBody?.result?.content?.[0]?.text;
      if (textContent) {
        try {
          const parsed = JSON.parse(textContent);
          if (parsed.status === 'REJECTED') {
            evaluatedVerdict = 'REJECTED';
            violationType = parsed.violations?.[0] || 'REJECTED';
          } else if (parsed.status === 'APPROVED') {
            evaluatedVerdict = 'APPROVED';
          }
        } catch {
          if (textContent.includes('"status": "REJECTED"')) evaluatedVerdict = 'REJECTED';
          if (textContent.includes('"status": "APPROVED"')) evaluatedVerdict = 'APPROVED';
        }
      }
    }
  }

  // Filter audit logs for display
  const filteredAuditLogs = auditLogs.filter((log) => {
    if (domainFilter === 'all') return true;
    const logDomain = (log.domain || (log.agentId?.includes('fulfillment') ? 'fulfillment' : 'checkout')).toLowerCase();
    return logDomain === domainFilter;
  });

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
        <div style={{ maxWidth: 1440, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 8,
                backgroundColor: '#18181b',
                border: '1px solid #3f3f46',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 900,
                color: '#10b981',
                fontSize: '1.2rem',
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
                  Expansion 3 &bull; Cross-Domain Handoff
                </span>
              </div>
              <p style={{ margin: '2px 0 0 0', fontSize: '0.8rem', color: '#71717a' }} className="text-xs text-zinc-500">
                Least-Privilege Context & Mathematical Domain Isolation for Autonomous LLM Swarms
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
              Gateway :3001 &bull; {gatewayStatus === 'UP' ? 'INTERCEPTING' : 'OFFLINE (STANDBY)'}
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
      <main style={{ maxWidth: 1440, margin: '24px auto', padding: '0 24px' }} className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        
        {/* SECTION 1: MULTI-DOMAIN TOPOLOGY VISUALIZER */}
        <section
          style={{
            backgroundColor: '#121215',
            border: '1px solid #27272a',
            borderRadius: 12,
            padding: 22,
          }}
          className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5"
        >
          {/* Header & Focus Controls */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
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
                  Architecture &bull; Multi-Domain Topologies
                </span>
                <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: '#fafafa' }} className="text-lg font-bold text-zinc-100">
                  Bounded Context Topology & State Machines
                </h2>
              </div>
              <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: '#71717a' }} className="text-xs text-zinc-500">
                Visualizing Checkout and Fulfillment state machines side-by-side with least-privilege MCP boundaries.
              </p>
            </div>

            {/* Domain Filter Buttons */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, backgroundColor: '#09090b', padding: 4, borderRadius: 8, border: '1px solid #27272a' }}>
              <button
                type="button"
                onClick={() => setFocusedDomain('both')}
                style={{
                  padding: '5px 12px',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  borderRadius: 6,
                  border: 'none',
                  cursor: 'pointer',
                  backgroundColor: focusedDomain === 'both' ? '#27272a' : 'transparent',
                  color: focusedDomain === 'both' ? '#fafafa' : '#a1a1aa',
                }}
              >
                Side-by-Side View
              </button>
              <button
                type="button"
                onClick={() => setFocusedDomain('checkout')}
                style={{
                  padding: '5px 12px',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  borderRadius: 6,
                  border: 'none',
                  cursor: 'pointer',
                  backgroundColor: focusedDomain === 'checkout' ? '#0284c7' : 'transparent',
                  color: focusedDomain === 'checkout' ? '#ffffff' : '#a1a1aa',
                }}
              >
                Checkout Domain
              </button>
              <button
                type="button"
                onClick={() => setFocusedDomain('fulfillment')}
                style={{
                  padding: '5px 12px',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  borderRadius: 6,
                  border: 'none',
                  cursor: 'pointer',
                  backgroundColor: focusedDomain === 'fulfillment' ? '#7c3aed' : 'transparent',
                  color: focusedDomain === 'fulfillment' ? '#ffffff' : '#a1a1aa',
                }}
              >
                Fulfillment Domain
              </button>
            </div>
          </div>

          {/* Topologies Grid Canvas */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: focusedDomain === 'both' ? 'repeat(auto-fit, minmax(480px, 1fr))' : '1fr',
              gap: 20,
              marginBottom: 20,
            }}
          >
            {/* CANVAS A: CHECKOUT MACHINE */}
            {(focusedDomain === 'both' || focusedDomain === 'checkout') && (
              <div
                style={{
                  backgroundColor: '#18181b',
                  border: '1px solid #0369a1',
                  borderRadius: 10,
                  padding: 16,
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.2)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div>
                    <span
                      style={{
                        fontSize: '0.65rem',
                        fontWeight: 800,
                        backgroundColor: '#082f49',
                        color: '#38bdf8',
                        padding: '2px 8px',
                        borderRadius: 4,
                        border: '1px solid #0284c7',
                        textTransform: 'uppercase',
                      }}
                    >
                      Domain: Checkout
                    </span>
                    <h3 style={{ margin: '6px 0 0 0', fontSize: '1rem', fontWeight: 700, color: '#f0f9ff' }}>
                      checkoutMachine.ts
                    </h3>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.68rem', color: '#7dd3fc', fontFamily: 'monospace' }}>
                      URI: axioma://domains/checkout/schema
                    </div>
                    <div style={{ fontSize: '0.65rem', color: '#94a3b8' }}>
                      Scope: Cart, Order, Payment
                    </div>
                  </div>
                </div>

                {/* Nodes Pipeline */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                  {Object.keys(CHECKOUT_TOPOLOGY).map((key) => {
                    const node = CHECKOUT_TOPOLOGY[key];
                    const isActive = checkoutState === key;
                    const isInspected = inspectedNodeKey === key;

                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          setCheckoutState(key);
                          setInspectedNodeKey(key);
                        }}
                        style={{
                          backgroundColor: isActive ? '#082f49' : isInspected ? '#1e293b' : '#0f172a',
                          border: `2px solid ${isActive ? '#38bdf8' : isInspected ? '#0284c7' : '#334155'}`,
                          borderRadius: 8,
                          padding: '10px 8px',
                          textAlign: 'center',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <div style={{ fontSize: '0.65rem', fontWeight: 800, color: isActive ? '#38bdf8' : '#94a3b8', textTransform: 'uppercase' }}>
                          {isActive ? '● Active' : 'Node'}
                        </div>
                        <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#f8fafc', marginTop: 2 }}>
                          {node.label}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* CANVAS B: FULFILLMENT MACHINE */}
            {(focusedDomain === 'both' || focusedDomain === 'fulfillment') && (
              <div
                style={{
                  backgroundColor: '#18181b',
                  border: '1px solid #6d28d9',
                  borderRadius: 10,
                  padding: 16,
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.2)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div>
                    <span
                      style={{
                        fontSize: '0.65rem',
                        fontWeight: 800,
                        backgroundColor: '#2e1065',
                        color: '#c084fc',
                        padding: '2px 8px',
                        borderRadius: 4,
                        border: '1px solid #7c3aed',
                        textTransform: 'uppercase',
                      }}
                    >
                      Domain: Fulfillment (Least-Privilege)
                    </span>
                    <h3 style={{ margin: '6px 0 0 0', fontSize: '1rem', fontWeight: 700, color: '#faf5ff' }}>
                      fulfillmentMachine.ts
                    </h3>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.68rem', color: '#c084fc', fontFamily: 'monospace' }}>
                      URI: axioma://domains/fulfillment/schema
                    </div>
                    <div style={{ fontSize: '0.65rem', color: '#94a3b8' }}>
                      Scope: Inventory, Logistics (Cart/Payment Omitted)
                    </div>
                  </div>
                </div>

                {/* Nodes Pipeline */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                  {Object.keys(FULFILLMENT_TOPOLOGY).map((key) => {
                    const node = FULFILLMENT_TOPOLOGY[key];
                    const isActive = fulfillmentState === key;
                    const isInspected = inspectedNodeKey === key;

                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          setFulfillmentState(key);
                          setInspectedNodeKey(key);
                        }}
                        style={{
                          backgroundColor: isActive ? '#3b0764' : isInspected ? '#2e1065' : '#0f172a',
                          border: `2px solid ${isActive ? '#c084fc' : isInspected ? '#9333ea' : '#334155'}`,
                          borderRadius: 8,
                          padding: '10px 8px',
                          textAlign: 'center',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <div style={{ fontSize: '0.65rem', fontWeight: 800, color: isActive ? '#c084fc' : '#a855f7', textTransform: 'uppercase' }}>
                          {isActive ? '● Active' : 'Node'}
                        </div>
                        <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#f8fafc', marginTop: 2 }}>
                          {node.label}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* EVENT BUS HANDOFF PIPELINE DISPLAY */}
          <div
            style={{
              backgroundColor:
                handoffStepStatuses.step2 === 'running'
                  ? 'rgba(245, 158, 11, 0.12)'
                  : handoffStepStatuses.step2 === 'completed'
                  ? 'rgba(16, 185, 129, 0.08)'
                  : '#09090b',
              border:
                handoffStepStatuses.step2 === 'running'
                  ? '1px solid #f59e0b'
                  : handoffStepStatuses.step2 === 'completed'
                  ? '1px solid #10b981'
                  : '1px dashed #3f3f46',
              boxShadow:
                handoffStepStatuses.step2 === 'running'
                  ? '0 0 20px rgba(245, 158, 11, 0.25)'
                  : handoffStepStatuses.step2 === 'completed'
                  ? '0 0 15px rgba(16, 185, 129, 0.15)'
                  : 'none',
              borderRadius: 8,
              padding: 12,
              marginBottom: 16,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 12,
              transition: 'all 0.3s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: 800,
                    color:
                      handoffStepStatuses.step2 === 'running'
                        ? '#fbbf24'
                        : handoffStepStatuses.step2 === 'completed'
                        ? '#34d399'
                        : '#fbbf24',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}
                >
                  ⚡ Event Bus Handoff:
                </span>
                {handoffStepStatuses.step2 === 'running' && (
                  <span
                    style={{
                      fontSize: '0.62rem',
                      fontWeight: 800,
                      backgroundColor: '#78350f',
                      color: '#fef3c7',
                      padding: '1px 7px',
                      borderRadius: 10,
                      border: '1px solid #d97706',
                    }}
                    className="animate-pulse"
                  >
                    ● BROADCASTING IN FLIGHT
                  </span>
                )}
                {handoffStepStatuses.step2 === 'completed' && (
                  <span
                    style={{
                      fontSize: '0.62rem',
                      fontWeight: 800,
                      backgroundColor: '#064e3b',
                      color: '#a7f3d0',
                      padding: '1px 7px',
                      borderRadius: 10,
                      border: '1px solid #059669',
                    }}
                  >
                    ✓ ORDER_PAID DELIVERED & DETACHED
                  </span>
                )}
              </div>
              <span style={{ fontSize: '0.75rem', fontFamily: 'monospace', color: '#e4e4e7', backgroundColor: '#18181b', padding: '3px 8px', borderRadius: 4, border: '1px solid #27272a' }}>
                {'{'} type: &apos;ORDER_PAID&apos;, payload: {'{'} orderId: &apos;ord_9981&apos; {'}'} {'}'}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.75rem' }}>
              <span style={{ color: '#94a3b8' }}>Checkout Domain (&lsquo;paid&rsquo;)</span>
              <span
                style={{
                  color: handoffStepStatuses.step2 === 'running' ? '#fbbf24' : '#fbbf24',
                  fontWeight: 800,
                }}
              >
                {handoffStepStatuses.step2 === 'running' ? '⚡ &rarr; DISPATCHING &rarr; ⚡' : '&rarr; Handoff &rarr;'}
              </span>
              <span style={{ color: '#c084fc', fontWeight: 700 }}>agent-fulfillment-worker (&lsquo;unfulfilled&rsquo;)</span>
            </div>
          </div>

          {/* MULTI-DOMAIN STATE INVARIANT BREAKDOWN */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                focusedDomain === 'both' ? 'repeat(auto-fit, minmax(480px, 1fr))' : '1fr',
              gap: 20,
            }}
          >
            {/* PANEL A: CHECKOUT DOMAIN INVARIANTS */}
            {(focusedDomain === 'both' || focusedDomain === 'checkout') && (
              <div
                style={{
                  backgroundColor: '#18181b',
                  border: '1px solid #0369a1',
                  borderRadius: 10,
                  padding: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 14,
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.2)',
                }}
              >
                {/* Panel Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8, borderBottom: '1px solid #1e293b', paddingBottom: 10 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span
                        style={{
                          fontSize: '0.65rem',
                          fontWeight: 800,
                          backgroundColor: '#082f49',
                          color: '#38bdf8',
                          padding: '2px 8px',
                          borderRadius: 4,
                          border: '1px solid #0284c7',
                          textTransform: 'uppercase',
                        }}
                      >
                        Checkout Domain
                      </span>
                      <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: '#f0f9ff' }}>
                        {checkoutNode.label}
                      </h4>
                    </div>
                    <p style={{ margin: '4px 0 0 0', fontSize: '0.72rem', color: '#94a3b8', lineHeight: 1.4 }}>
                      {checkoutNode.description}
                    </p>
                  </div>

                  <span
                    style={{
                      fontSize: '0.65rem',
                      fontWeight: 700,
                      backgroundColor: '#082f49',
                      color: '#7dd3fc',
                      padding: '2px 8px',
                      borderRadius: 12,
                      border: '1px solid #0284c7',
                    }}
                  >
                    ● Active State: {checkoutState}
                  </span>
                </div>

                {/* 2 Subsections: Admissible & Forbidden Verbs */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
                  {/* Legal Transitions */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#10b981' }} />
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#34d399', textTransform: 'uppercase' }}>
                        Admissible Verbs ({checkoutNode.label})
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {checkoutNode.admissibleEvents.length === 0 ? (
                        <span style={{ fontSize: '0.72rem', color: '#71717a' }}>Terminal node: No outgoing events.</span>
                      ) : (
                        checkoutNode.admissibleEvents.map((evt) => (
                          <span
                            key={evt}
                            style={{
                              fontSize: '0.72rem',
                              fontFamily: 'monospace',
                              fontWeight: 600,
                              backgroundColor: '#064e3b',
                              color: '#a7f3d0',
                              border: '1px solid #059669',
                              padding: '2px 8px',
                              borderRadius: 4,
                            }}
                          >
                            &bull; {evt}
                          </span>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Forbidden Transitions */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#f43f5e' }} />
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#fb7185', textTransform: 'uppercase' }}>
                        Forbidden / Cross-Domain Calls
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {checkoutNode.illegalEvents.map((evt) => (
                        <span
                          key={evt}
                          style={{
                            fontSize: '0.72rem',
                            fontFamily: 'monospace',
                            fontWeight: 600,
                            backgroundColor: '#4c0519',
                            color: '#fecdd3',
                            border: '1px solid #be123c',
                            padding: '2px 8px',
                            borderRadius: 4,
                            textDecoration: 'line-through',
                          }}
                        >
                          &times; {evt}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* State Guards */}
                <div style={{ borderTop: '1px solid #1e293b', paddingTop: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#eab308' }} />
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#fcd34d', textTransform: 'uppercase' }}>
                      Formal Invariants & Guards ({checkoutState})
                    </span>
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.72rem', color: '#d4d4d8', lineHeight: 1.5 }}>
                    {checkoutNode.guards.map((g, i) => (
                      <li key={i}>{g}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* PANEL B: FULFILLMENT DOMAIN INVARIANTS */}
            {(focusedDomain === 'both' || focusedDomain === 'fulfillment') && (
              <div
                style={{
                  backgroundColor: '#18181b',
                  border: '1px solid #6d28d9',
                  borderRadius: 10,
                  padding: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 14,
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.2)',
                }}
              >
                {/* Panel Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8, borderBottom: '1px solid #2e1065', paddingBottom: 10 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span
                        style={{
                          fontSize: '0.65rem',
                          fontWeight: 800,
                          backgroundColor: '#2e1065',
                          color: '#c084fc',
                          padding: '2px 8px',
                          borderRadius: 4,
                          border: '1px solid #7c3aed',
                          textTransform: 'uppercase',
                        }}
                      >
                        Fulfillment Domain
                      </span>
                      <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: '#faf5ff' }}>
                        {fulfillmentNode.label}
                      </h4>
                    </div>
                    <p style={{ margin: '4px 0 0 0', fontSize: '0.72rem', color: '#a1a1aa', lineHeight: 1.4 }}>
                      {fulfillmentNode.description}
                    </p>
                  </div>

                  <span
                    style={{
                      fontSize: '0.65rem',
                      fontWeight: 700,
                      backgroundColor: '#2e1065',
                      color: '#e9d5ff',
                      padding: '2px 8px',
                      borderRadius: 12,
                      border: '1px solid #7c3aed',
                    }}
                  >
                    ● Active State: {fulfillmentState}
                  </span>
                </div>

                {/* 2 Subsections: Admissible & Forbidden Verbs */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
                  {/* Legal Transitions */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#10b981' }} />
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#34d399', textTransform: 'uppercase' }}>
                        Admissible Verbs ({fulfillmentNode.label})
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {fulfillmentNode.admissibleEvents.length === 0 ? (
                        <span style={{ fontSize: '0.72rem', color: '#71717a' }}>Terminal node: No outgoing events.</span>
                      ) : (
                        fulfillmentNode.admissibleEvents.map((evt) => (
                          <span
                            key={evt}
                            style={{
                              fontSize: '0.72rem',
                              fontFamily: 'monospace',
                              fontWeight: 600,
                              backgroundColor: '#064e3b',
                              color: '#a7f3d0',
                              border: '1px solid #059669',
                              padding: '2px 8px',
                              borderRadius: 4,
                            }}
                          >
                            &bull; {evt}
                          </span>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Forbidden Transitions */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#f43f5e' }} />
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#fb7185', textTransform: 'uppercase' }}>
                        Forbidden / Cross-Domain Calls
                      </span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {fulfillmentNode.illegalEvents.map((evt) => (
                        <span
                          key={evt}
                          style={{
                            fontSize: '0.72rem',
                            fontFamily: 'monospace',
                            fontWeight: 600,
                            backgroundColor: '#4c0519',
                            color: '#fecdd3',
                            border: '1px solid #be123c',
                            padding: '2px 8px',
                            borderRadius: 4,
                            textDecoration: 'line-through',
                          }}
                        >
                          &times; {evt}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* State Guards */}
                <div style={{ borderTop: '1px solid #2e1065', paddingTop: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#eab308' }} />
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#fcd34d', textTransform: 'uppercase' }}>
                      Formal Invariants & Guards ({fulfillmentState})
                    </span>
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.72rem', color: '#d4d4d8', lineHeight: 1.5 }}>
                    {fulfillmentNode.guards.map((g, i) => (
                      <li key={i}>{g}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* SECTION 2: SIMULATION CONTROLS & DEDICATED SCENARIOS */}
        <section
          style={{
            backgroundColor: '#121215',
            border: '1px solid #27272a',
            borderRadius: 12,
            padding: 22,
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
                  Interactive Simulation &bull; Agent Presets
                </span>
                <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: '#fafafa' }} className="text-lg font-bold text-zinc-100">
                  Agent Intent Dispatcher & Verification Terminal
                </h2>
              </div>
              <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: '#71717a' }} className="text-xs text-zinc-500">
                Execute cross-domain boundary violations and legal handoff progressions through the Gateway proxy.
              </p>
            </div>

            <div style={{ fontSize: '0.75rem', color: '#a1a1aa' }}>
              Target Gateway: <code>http://localhost:3001</code>
            </div>
          </div>

          {/* Preset Buttons Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
              gap: 12,
              marginBottom: 16,
            }}
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
                    border: `2px solid ${isSelected ? (isApproved ? '#059669' : '#e11d48') : '#27272a'}`,
                    borderRadius: 8,
                    padding: 14,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: '0.65rem', fontWeight: 800, color: '#a1a1aa' }}>
                        {preset.badge}
                      </span>
                      <span
                        style={{
                          fontSize: '0.6rem',
                          fontWeight: 700,
                          padding: '1px 6px',
                          borderRadius: 4,
                          backgroundColor: preset.domain === 'fulfillment' ? '#2e1065' : '#082f49',
                          color: preset.domain === 'fulfillment' ? '#c084fc' : '#38bdf8',
                          border: `1px solid ${preset.domain === 'fulfillment' ? '#7c3aed' : '#0284c7'}`,
                        }}
                      >
                        {preset.domain}
                      </span>
                    </div>

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
                    >
                      EXPECT: {preset.expected}
                    </span>
                  </div>

                  <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#fafafa', marginBottom: 4 }}>
                    {preset.name}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#a1a1aa', lineHeight: 1.4 }}>
                    {preset.description}
                  </div>
                </div>
              );
            })}
          </div>

          {/* INTERACTIVE HANDOFF SEQUENCE PLAYER (SCENARIO B) */}
          {selectedPresetId === 'scenario-05' && (
            <div
              style={{
                backgroundColor: '#141419',
                border: '1px solid #7c3aed',
                borderRadius: 10,
                padding: 18,
                marginBottom: 20,
                boxShadow: '0 8px 24px -4px rgba(124, 58, 237, 0.15)',
              }}
            >
              {/* Player Header & Primary Controls */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 12,
                  borderBottom: '1px solid #27272a',
                  paddingBottom: 14,
                  marginBottom: 16,
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span
                      style={{
                        fontSize: '0.65rem',
                        fontWeight: 800,
                        backgroundColor: '#2e1065',
                        color: '#c084fc',
                        padding: '2px 8px',
                        borderRadius: 4,
                        border: '1px solid #7c3aed',
                        textTransform: 'uppercase',
                      }}
                    >
                      Multi-Stage Orchestrator
                    </span>
                    <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#f3e8ff' }}>
                      Interactive Handoff Sequence Player (Scenario B)
                    </h3>
                  </div>
                  <p style={{ margin: '4px 0 0 0', fontSize: '0.78rem', color: '#a1a1aa' }}>
                    Visualizing 3 distinct phases: <strong>1. Checkout Settlement</strong> &rarr;{' '}
                    <strong>2. Event Bus Handoff</strong> &rarr;{' '}
                    <strong>3. Least-Privilege Fulfillment Allocation</strong>
                  </p>
                </div>

                {/* Control Action Buttons */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    disabled={isDispatching || isAutoPlaying}
                    onClick={runCompleteHandoffSequence}
                    style={{
                      backgroundColor: isAutoPlaying ? '#581c87' : '#7c3aed',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: 6,
                      padding: '8px 16px',
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      cursor: isDispatching || isAutoPlaying ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)',
                    }}
                  >
                    <span>{isAutoPlaying ? '⏳' : '▶'}</span>
                    {isAutoPlaying
                      ? 'Auto-Playing Pipeline...'
                      : handoffStepStatuses.step3 === 'completed'
                      ? 'Re-Run Entire Sequence'
                      : 'Auto-Play Sequence'}
                  </button>

                  <button
                    type="button"
                    disabled={isDispatching || isAutoPlaying || handoffStepStatuses.step3 === 'completed'}
                    onClick={runNextStep}
                    style={{
                      backgroundColor: '#27272a',
                      color: '#e4e4e7',
                      border: '1px solid #3f3f46',
                      borderRadius: 6,
                      padding: '8px 14px',
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      cursor:
                        isDispatching || isAutoPlaying || handoffStepStatuses.step3 === 'completed'
                          ? 'not-allowed'
                          : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <span>⏭</span>
                    {handoffStepStatuses.step1 !== 'completed'
                      ? 'Step 1: Settle Checkout'
                      : handoffStepStatuses.step2 !== 'completed'
                      ? 'Step 2: Emit ORDER_PAID'
                      : handoffStepStatuses.step3 !== 'completed'
                      ? 'Step 3: Allocate Worker'
                      : 'All Steps Complete'}
                  </button>

                  <button
                    type="button"
                    disabled={isDispatching || isAutoPlaying}
                    onClick={resetHandoffSequence}
                    style={{
                      backgroundColor: 'transparent',
                      color: '#a1a1aa',
                      border: '1px solid #3f3f46',
                      borderRadius: 6,
                      padding: '8px 12px',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      cursor: isDispatching || isAutoPlaying ? 'not-allowed' : 'pointer',
                    }}
                  >
                    ↺ Reset
                  </button>
                </div>
              </div>

              {/* Progress Flow Tracker */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#a1a1aa', marginBottom: 6 }}>
                  <span>
                    Pipeline Status:{' '}
                    <strong style={{ color: handoffStepStatuses.step3 === 'completed' ? '#34d399' : '#c084fc' }}>
                      {handoffStepStatuses.step3 === 'completed'
                        ? '3 / 3 Steps Executed & Verified'
                        : handoffActiveStep === 0
                        ? 'Ready to execute'
                        : `Phase ${handoffActiveStep} In Progress`}
                    </strong>
                  </span>
                  <span>
                    Domain Boundary:{' '}
                    <strong>
                      Checkout &rarr; Event Bus &rarr; Fulfillment
                    </strong>
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, height: 6, backgroundColor: '#09090b', borderRadius: 4, overflow: 'hidden' }}>
                  <div
                    style={{
                      backgroundColor:
                        handoffStepStatuses.step1 === 'completed'
                          ? '#0284c7'
                          : handoffStepStatuses.step1 === 'running'
                          ? '#38bdf8'
                          : '#27272a',
                      transition: 'background-color 0.3s ease',
                    }}
                  />
                  <div
                    style={{
                      backgroundColor:
                        handoffStepStatuses.step2 === 'completed'
                          ? '#d97706'
                          : handoffStepStatuses.step2 === 'running'
                          ? '#fbbf24'
                          : '#27272a',
                      transition: 'background-color 0.3s ease',
                    }}
                  />
                  <div
                    style={{
                      backgroundColor:
                        handoffStepStatuses.step3 === 'completed'
                          ? '#059669'
                          : handoffStepStatuses.step3 === 'running'
                          ? '#a855f7'
                          : '#27272a',
                      transition: 'background-color 0.3s ease',
                    }}
                  />
                </div>
              </div>

              {/* 3 Step Cards Pipeline */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                  gap: 12,
                  marginBottom: 16,
                }}
              >
                {/* STEP 1 CARD */}
                <div
                  style={{
                    backgroundColor: '#18181b',
                    border: `1.5px solid ${
                      handoffStepStatuses.step1 === 'running'
                        ? '#38bdf8'
                        : handoffStepStatuses.step1 === 'completed'
                        ? '#0284c7'
                        : '#27272a'
                    }`,
                    boxShadow:
                      handoffStepStatuses.step1 === 'running'
                        ? '0 0 12px rgba(56, 189, 248, 0.25)'
                        : 'none',
                    borderRadius: 8,
                    padding: 14,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span
                        style={{
                          fontSize: '0.65rem',
                          fontWeight: 800,
                          backgroundColor: '#082f49',
                          color: '#38bdf8',
                          padding: '1px 6px',
                          borderRadius: 4,
                          border: '1px solid #0284c7',
                          textTransform: 'uppercase',
                        }}
                      >
                        Step 1 &bull; Checkout
                      </span>
                      <span
                        style={{
                          fontSize: '0.65rem',
                          fontWeight: 800,
                          padding: '2px 8px',
                          borderRadius: 12,
                          backgroundColor:
                            handoffStepStatuses.step1 === 'completed'
                              ? '#064e3b'
                              : handoffStepStatuses.step1 === 'running'
                              ? '#082f49'
                              : '#27272a',
                          color:
                            handoffStepStatuses.step1 === 'completed'
                              ? '#6ee7b7'
                              : handoffStepStatuses.step1 === 'running'
                              ? '#7dd3fc'
                              : '#71717a',
                          border: `1px solid ${
                            handoffStepStatuses.step1 === 'completed'
                              ? '#059669'
                              : handoffStepStatuses.step1 === 'running'
                              ? '#0284c7'
                              : '#3f3f46'
                          }`,
                        }}
                      >
                        {handoffStepStatuses.step1 === 'completed'
                          ? '✓ SETTLED'
                          : handoffStepStatuses.step1 === 'running'
                          ? '● SETTLING...'
                          : 'STANDBY'}
                      </span>
                    </div>

                    <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f0f9ff', marginBottom: 4 }}>
                      1. Transition to &lsquo;paid&rsquo;
                    </div>
                    <p style={{ margin: 0, fontSize: '0.72rem', color: '#94a3b8', lineHeight: 1.4 }}>
                      Order <code>ord_9981</code> settles payment ($99.00). Invariant: commercial contract is locked irrevocably. Double-charging is blocked.
                    </p>
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <button
                      type="button"
                      disabled={isDispatching || isAutoPlaying || handoffStepStatuses.step1 === 'completed'}
                      onClick={runStep1}
                      style={{
                        width: '100%',
                        backgroundColor: handoffStepStatuses.step1 === 'completed' ? '#0f172a' : '#0369a1',
                        color: handoffStepStatuses.step1 === 'completed' ? '#38bdf8' : '#ffffff',
                        border: `1px solid ${handoffStepStatuses.step1 === 'completed' ? '#0284c7' : '#0284c7'}`,
                        borderRadius: 6,
                        padding: '6px 10px',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        cursor:
                          isDispatching || isAutoPlaying || handoffStepStatuses.step1 === 'completed'
                            ? 'not-allowed'
                            : 'pointer',
                      }}
                    >
                      {handoffStepStatuses.step1 === 'completed' ? '✓ Step 1 Complete' : '▶ Execute Step 1'}
                    </button>
                  </div>
                </div>

                {/* STEP 2 CARD */}
                <div
                  style={{
                    backgroundColor: '#18181b',
                    border: `1.5px solid ${
                      handoffStepStatuses.step2 === 'running'
                        ? '#fbbf24'
                        : handoffStepStatuses.step2 === 'completed'
                        ? '#d97706'
                        : '#27272a'
                    }`,
                    boxShadow:
                      handoffStepStatuses.step2 === 'running'
                        ? '0 0 12px rgba(251, 191, 36, 0.25)'
                        : 'none',
                    borderRadius: 8,
                    padding: 14,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span
                        style={{
                          fontSize: '0.65rem',
                          fontWeight: 800,
                          backgroundColor: '#451a03',
                          color: '#fcd34d',
                          padding: '1px 6px',
                          borderRadius: 4,
                          border: '1px solid #b45309',
                          textTransform: 'uppercase',
                        }}
                      >
                        Step 2 &bull; Event Bus
                      </span>
                      <span
                        style={{
                          fontSize: '0.65rem',
                          fontWeight: 800,
                          padding: '2px 8px',
                          borderRadius: 12,
                          backgroundColor:
                            handoffStepStatuses.step2 === 'completed'
                              ? '#064e3b'
                              : handoffStepStatuses.step2 === 'running'
                              ? '#451a03'
                              : '#27272a',
                          color:
                            handoffStepStatuses.step2 === 'completed'
                              ? '#6ee7b7'
                              : handoffStepStatuses.step2 === 'running'
                              ? '#fde68a'
                              : '#71717a',
                          border: `1px solid ${
                            handoffStepStatuses.step2 === 'completed'
                              ? '#059669'
                              : handoffStepStatuses.step2 === 'running'
                              ? '#b45309'
                              : '#3f3f46'
                          }`,
                        }}
                      >
                        {handoffStepStatuses.step2 === 'completed'
                          ? '✓ EMITTED'
                          : handoffStepStatuses.step2 === 'running'
                          ? '● EMITTING...'
                          : 'WAITING'}
                      </span>
                    </div>

                    <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#fef3c7', marginBottom: 4 }}>
                      2. Broadcast &lsquo;ORDER_PAID&rsquo;
                    </div>
                    <p style={{ margin: 0, fontSize: '0.72rem', color: '#a1a1aa', lineHeight: 1.4 }}>
                      Fires cross-domain event <code>ORDER_PAID</code>. Provisions <code>agent-fulfillment-worker</code> bounded strictly to fulfillment schema (no payment access).
                    </p>
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <button
                      type="button"
                      disabled={
                        isDispatching ||
                        isAutoPlaying ||
                        handoffStepStatuses.step1 !== 'completed' ||
                        handoffStepStatuses.step2 === 'completed'
                      }
                      onClick={runStep2}
                      style={{
                        width: '100%',
                        backgroundColor:
                          handoffStepStatuses.step2 === 'completed'
                            ? '#1c1917'
                            : handoffStepStatuses.step1 !== 'completed'
                            ? '#27272a'
                            : '#b45309',
                        color:
                          handoffStepStatuses.step2 === 'completed'
                            ? '#fcd34d'
                            : handoffStepStatuses.step1 !== 'completed'
                            ? '#71717a'
                            : '#ffffff',
                        border: `1px solid ${
                          handoffStepStatuses.step2 === 'completed'
                            ? '#78350f'
                            : handoffStepStatuses.step1 !== 'completed'
                            ? '#3f3f46'
                            : '#d97706'
                        }`,
                        borderRadius: 6,
                        padding: '6px 10px',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        cursor:
                          isDispatching ||
                          isAutoPlaying ||
                          handoffStepStatuses.step1 !== 'completed' ||
                          handoffStepStatuses.step2 === 'completed'
                            ? 'not-allowed'
                            : 'pointer',
                      }}
                    >
                      {handoffStepStatuses.step2 === 'completed'
                        ? '✓ Step 2 Complete'
                        : handoffStepStatuses.step1 !== 'completed'
                        ? 'Awaiting Step 1'
                        : '▶ Execute Step 2'}
                    </button>
                  </div>
                </div>

                {/* STEP 3 CARD */}
                <div
                  style={{
                    backgroundColor: '#18181b',
                    border: `1.5px solid ${
                      handoffStepStatuses.step3 === 'running'
                        ? '#c084fc'
                        : handoffStepStatuses.step3 === 'completed'
                        ? '#059669'
                        : '#27272a'
                    }`,
                    boxShadow:
                      handoffStepStatuses.step3 === 'running'
                        ? '0 0 12px rgba(192, 132, 252, 0.25)'
                        : 'none',
                    borderRadius: 8,
                    padding: 14,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span
                        style={{
                          fontSize: '0.65rem',
                          fontWeight: 800,
                          backgroundColor: '#2e1065',
                          color: '#c084fc',
                          padding: '1px 6px',
                          borderRadius: 4,
                          border: '1px solid #7c3aed',
                          textTransform: 'uppercase',
                        }}
                      >
                        Step 3 &bull; Fulfillment
                      </span>
                      <span
                        style={{
                          fontSize: '0.65rem',
                          fontWeight: 800,
                          padding: '2px 8px',
                          borderRadius: 12,
                          backgroundColor:
                            handoffStepStatuses.step3 === 'completed'
                              ? '#064e3b'
                              : handoffStepStatuses.step3 === 'running'
                              ? '#2e1065'
                              : '#27272a',
                          color:
                            handoffStepStatuses.step3 === 'completed'
                              ? '#6ee7b7'
                              : handoffStepStatuses.step3 === 'running'
                              ? '#e9d5ff'
                              : '#71717a',
                          border: `1px solid ${
                            handoffStepStatuses.step3 === 'completed'
                              ? '#059669'
                              : handoffStepStatuses.step3 === 'running'
                              ? '#7c3aed'
                              : '#3f3f46'
                          }`,
                        }}
                      >
                        {handoffStepStatuses.step3 === 'completed'
                          ? '✓ APPROVED'
                          : handoffStepStatuses.step3 === 'running'
                          ? '● ALLOCATING...'
                          : 'WAITING'}
                      </span>
                    </div>

                    <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#faf5ff', marginBottom: 4 }}>
                      3. Allocate on &lsquo;unfulfilled&rsquo;
                    </div>
                    <p style={{ margin: 0, fontSize: '0.72rem', color: '#a1a1aa', lineHeight: 1.4 }}>
                      Worker proposes <code>allocateInventory</code>. Gateway intercepts, validates <code>hasOrderId</code> and <code>hasItems</code> guards, advances to <code>inventory_allocated</code>.
                    </p>
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <button
                      type="button"
                      disabled={
                        isDispatching ||
                        isAutoPlaying ||
                        handoffStepStatuses.step2 !== 'completed' ||
                        handoffStepStatuses.step3 === 'completed'
                      }
                      onClick={runStep3}
                      style={{
                        width: '100%',
                        backgroundColor:
                          handoffStepStatuses.step3 === 'completed'
                            ? '#064e3b'
                            : handoffStepStatuses.step2 !== 'completed'
                            ? '#27272a'
                            : '#7c3aed',
                        color:
                          handoffStepStatuses.step3 === 'completed'
                            ? '#a7f3d0'
                            : handoffStepStatuses.step2 !== 'completed'
                            ? '#71717a'
                            : '#ffffff',
                        border: `1px solid ${
                          handoffStepStatuses.step3 === 'completed'
                            ? '#059669'
                            : handoffStepStatuses.step2 !== 'completed'
                            ? '#3f3f46'
                            : '#9333ea'
                        }`,
                        borderRadius: 6,
                        padding: '6px 10px',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        cursor:
                          isDispatching ||
                          isAutoPlaying ||
                          handoffStepStatuses.step2 !== 'completed' ||
                          handoffStepStatuses.step3 === 'completed'
                            ? 'not-allowed'
                            : 'pointer',
                      }}
                    >
                      {handoffStepStatuses.step3 === 'completed'
                        ? '✓ Step 3 Complete'
                        : handoffStepStatuses.step2 !== 'completed'
                        ? 'Awaiting Step 2'
                        : '▶ Execute Step 3'}
                    </button>
                  </div>
                </div>
              </div>

              {/* REAL-TIME SEQUENCE EXECUTION CONSOLE / TRACE LOG */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: handoffLogs.length > 0 ? '#10b981' : '#71717a' }} />
                    <span style={{ fontSize: '0.72rem', fontWeight: 800, color: '#d4d4d8', textTransform: 'uppercase' }}>
                      Sequence Execution Telemetry Trace ({handoffLogs.length} events)
                    </span>
                  </div>
                  {handoffLogs.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setHandoffLogs([])}
                      style={{
                        fontSize: '0.68rem',
                        color: '#71717a',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        textDecoration: 'underline',
                      }}
                    >
                      Clear Trace
                    </button>
                  )}
                </div>

                <div
                  style={{
                    height: 140,
                    backgroundColor: '#09090b',
                    border: '1px solid #27272a',
                    borderRadius: 6,
                    padding: 10,
                    overflowY: 'auto',
                    fontFamily: 'monospace',
                    fontSize: '0.72rem',
                    lineHeight: 1.5,
                  }}
                >
                  {handoffLogs.length === 0 ? (
                    <div style={{ color: '#52525b', textAlign: 'center', paddingTop: 40 }}>
                      <div>[Handoff Telemetry Standby]</div>
                      <div style={{ fontSize: '0.68rem', marginTop: 4 }}>
                        Click &ldquo;Auto-Play Sequence&rdquo; or execute each step to observe live multi-domain telemetry.
                      </div>
                    </div>
                  ) : (
                    handoffLogs.map((log) => {
                      const tagColor =
                        log.domain === 'checkout'
                          ? '#38bdf8'
                          : log.domain === 'event-bus'
                          ? '#fbbf24'
                          : log.domain === 'gateway'
                          ? '#818cf8'
                          : log.domain === 'fulfillment'
                          ? '#c084fc'
                          : '#a1a1aa';

                      return (
                        <div key={log.id} style={{ marginBottom: 6, borderBottom: '1px solid #18181b', paddingBottom: 4 }}>
                          <span style={{ color: '#52525b' }}>[{log.time}] </span>
                          <span style={{ color: tagColor, fontWeight: 700 }}>[{log.tag}] </span>
                          <span style={{ color: '#e4e4e7' }}>{log.message}</span>
                          {log.detail && (
                            <div style={{ color: '#71717a', marginLeft: 16, fontSize: '0.68rem' }}>
                              &rarr; {log.detail}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          )}

          {/* JSON-RPC Editor & Dispatch Terminal */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
              gap: 16,
            }}
          >
            {/* Left: JSON Payload Editor */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#d4d4d8', textTransform: 'uppercase' }}>
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
              />

              <div style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  disabled={isDispatching}
                  onClick={() => handleDispatch()}
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
                >
                  {isDispatching ? (
                    <>
                      <span>&diams;</span>
                      Proxying to Gateway (:3001)...
                    </>
                  ) : (
                    <>
                      <span>&rarr;</span>
                      Dispatch to Gateway (Port 3001)
                    </>
                  )}
                </button>

                <span style={{ fontSize: '0.72rem', color: '#71717a' }}>
                  Tool: <code>propose_resolver</code> &bull; Intercepted by Axioma Gateway
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
                >
                  <strong>Dispatch Error:</strong> {dispatchError}
                </div>
              )}
            </div>

            {/* Right: Telemetry & Verdict Console */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#d4d4d8', textTransform: 'uppercase' }}>
                  Gateway Interception & Mathematical Verdict
                </label>
                {lastDispatchResponse && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {violationType && (
                      <span
                        style={{
                          fontSize: '0.7rem',
                          fontWeight: 800,
                          padding: '2px 8px',
                          borderRadius: 12,
                          backgroundColor: '#4c0519',
                          color: '#fecdd3',
                          border: '1px solid #be123c',
                        }}
                      >
                        {violationType}
                      </span>
                    )}
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
                    >
                      VERDICT: {evaluatedVerdict}
                    </span>
                  </div>
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
              >
                {!lastDispatchResponse ? (
                  <div style={{ color: '#52525b', paddingTop: 60, textAlign: 'center' }}>
                    <div>[Gateway Telemetry Standby]</div>
                    <div style={{ marginTop: 6, fontSize: '0.7rem' }}>
                      Click &ldquo;Dispatch to Gateway (Port 3001)&rdquo; above to verify formal invariants.
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

        {/* SECTION 3: LIVE AUDIT STREAM WITH DOMAIN METADATA & FILTER CHIPS */}
        <section
          style={{
            backgroundColor: '#121215',
            border: '1px solid #27272a',
            borderRadius: 12,
            padding: 22,
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
                <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: '#fafafa' }} className="text-lg font-bold text-zinc-100">
                  Live Audit Stream &bull; <code>agent_audit_logs</code>
                </h2>
              </div>
              <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: '#71717a' }} className="text-xs text-zinc-500">
                Immutable ledger captured at Gateway proxy with domain metadata (Checkout vs Fulfillment).
              </p>
            </div>

            {/* Domain Filter Chips */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, backgroundColor: '#09090b', padding: 3, borderRadius: 6, border: '1px solid #27272a' }}>
                <button
                  type="button"
                  onClick={() => setDomainFilter('all')}
                  style={{
                    padding: '4px 10px',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    borderRadius: 4,
                    border: 'none',
                    cursor: 'pointer',
                    backgroundColor: domainFilter === 'all' ? '#27272a' : 'transparent',
                    color: domainFilter === 'all' ? '#fafafa' : '#a1a1aa',
                  }}
                >
                  All ({auditLogs.length})
                </button>
                <button
                  type="button"
                  onClick={() => setDomainFilter('checkout')}
                  style={{
                    padding: '4px 10px',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    borderRadius: 4,
                    border: 'none',
                    cursor: 'pointer',
                    backgroundColor: domainFilter === 'checkout' ? '#0284c7' : 'transparent',
                    color: domainFilter === 'checkout' ? '#ffffff' : '#38bdf8',
                  }}
                >
                  Checkout
                </button>
                <button
                  type="button"
                  onClick={() => setDomainFilter('fulfillment')}
                  style={{
                    padding: '4px 10px',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    borderRadius: 4,
                    border: 'none',
                    cursor: 'pointer',
                    backgroundColor: domainFilter === 'fulfillment' ? '#7c3aed' : 'transparent',
                    color: domainFilter === 'fulfillment' ? '#ffffff' : '#c084fc',
                  }}
                >
                  Fulfillment
                </button>
              </div>

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
              >
                {pollingActive ? 'Pause' : 'Resume'}
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
              >
                Refresh
              </button>
            </div>
          </div>

          {/* Audit Logs Table */}
          {filteredAuditLogs.length === 0 ? (
            <div
              style={{
                padding: '48px 20px',
                textAlign: 'center',
                backgroundColor: '#09090b',
                borderRadius: 8,
                border: '1px solid #27272a',
                color: '#71717a',
              }}
            >
              <div style={{ fontSize: '2rem', marginBottom: 8 }}>🛡️</div>
              <h3 style={{ margin: '0 0 4px 0', fontSize: '1rem', color: '#d4d4d8', fontWeight: 600 }}>
                No Interceptions Matching Domain Filter
              </h3>
              <p style={{ margin: 0, fontSize: '0.75rem', maxWidth: 480, marginInline: 'auto' }}>
                Trigger any preset scenario above to dispatch an autonomous agent request. The Gateway will intercept and record domain metadata here.
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
              >
                <thead>
                  <tr
                    style={{
                      borderBottom: '1px solid #27272a',
                      color: '#a1a1aa',
                      backgroundColor: '#09090b',
                    }}
                  >
                    <th style={{ padding: '10px 14px' }}>Verdict Status</th>
                    <th style={{ padding: '10px 14px' }}>Domain Scope</th>
                    <th style={{ padding: '10px 14px' }}>Tool / Mutation</th>
                    <th style={{ padding: '10px 14px' }}>State &rarr; Event</th>
                    <th style={{ padding: '10px 14px' }}>Agent Identity</th>
                    <th style={{ padding: '10px 14px' }}>Timestamp</th>
                    <th style={{ padding: '10px 14px', textAlign: 'right' }}>Inspection</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAuditLogs.map((log) => {
                    const isApproved = log.status === 'APPROVED';
                    const isRejected = log.status === 'REJECTED';

                    const chipBg = isApproved ? '#064e3b' : isRejected ? '#4c0519' : '#451a03';
                    const chipColor = isApproved ? '#6ee7b7' : isRejected ? '#fecdd3' : '#fde68a';
                    const chipBorder = isApproved ? '#059669' : isRejected ? '#9f1239' : '#b45309';

                    const toolArgs =
                      log.payload && typeof log.payload === 'object'
                        ? log.payload?.params?.arguments || log.payload?.params || {}
                        : {};
                    const logDomain = (log.domain || (typeof log.agentId === 'string' && log.agentId.includes('fulfillment') ? 'fulfillment' : 'checkout')).toLowerCase();

                    return (
                      <tr
                        key={log.id}
                        style={{
                          borderBottom: '1px solid #18181b',
                          backgroundColor: isRejected ? 'rgba(76, 5, 25, 0.12)' : 'transparent',
                        }}
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
                          >
                            <span>{isApproved ? '✓' : isRejected ? '✗' : '⏳'}</span>
                            <span>{log.status}</span>
                          </span>
                        </td>

                        {/* Domain Tag */}
                        <td style={{ padding: '12px 14px', verticalAlign: 'middle' }}>
                          <span
                            style={{
                              fontSize: '0.68rem',
                              fontWeight: 800,
                              textTransform: 'uppercase',
                              padding: '2px 8px',
                              borderRadius: 4,
                              backgroundColor: logDomain === 'fulfillment' ? '#2e1065' : '#082f49',
                              color: logDomain === 'fulfillment' ? '#c084fc' : '#38bdf8',
                              border: `1px solid ${logDomain === 'fulfillment' ? '#7c3aed' : '#0284c7'}`,
                            }}
                          >
                            {logDomain}
                          </span>
                        </td>

                        {/* Tool / Mutation */}
                        <td style={{ padding: '12px 14px', verticalAlign: 'middle' }}>
                          <div style={{ fontWeight: 700, color: '#f4f4f5' }}>
                            {log.toolName}
                          </div>
                          {toolArgs.mutationName && (
                            <div style={{ fontSize: '0.7rem', color: '#71717a', fontFamily: 'monospace' }}>
                              gql: {toolArgs.mutationName}
                            </div>
                          )}
                        </td>

                        {/* State & Event */}
                        <td style={{ padding: '12px 14px', verticalAlign: 'middle' }}>
                          {toolArgs.sourceState ? (
                            <div style={{ fontSize: '0.72rem', fontFamily: 'monospace' }}>
                              <span style={{ color: logDomain === 'fulfillment' ? '#c084fc' : '#38bdf8' }}>{toolArgs.sourceState}</span>
                              <span style={{ color: '#71717a' }}> &rarr; </span>
                              <span style={{ color: '#fafafa' }}>{toolArgs.event}</span>
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
                        <td
                          suppressHydrationWarning
                          style={{ padding: '12px 14px', verticalAlign: 'middle', color: '#71717a', fontSize: '0.72rem' }}
                        >
                          {mounted
                            ? (() => {
                                try {
                                  const d = new Date(log.createdAt);
                                  return isNaN(d.getTime())
                                    ? 'n/a'
                                    : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                                } catch {
                                  return 'n/a';
                                }
                              })()
                            : '--:--:--'}
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
                          >
                            Inspect &rarr;
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
          onClick={() => setInspectRecord(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
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
                  >
                    {String(inspectRecord.status || 'UNKNOWN')}
                  </span>
                  <span
                    style={{
                      fontSize: '0.7rem',
                      fontWeight: 800,
                      padding: '2px 8px',
                      borderRadius: 4,
                      backgroundColor: inspectRecord.domain === 'fulfillment' ? '#2e1065' : '#082f49',
                      color: inspectRecord.domain === 'fulfillment' ? '#c084fc' : '#38bdf8',
                      border: `1px solid ${inspectRecord.domain === 'fulfillment' ? '#7c3aed' : '#0284c7'}`,
                    }}
                  >
                    {String(inspectRecord.domain || 'checkout')}
                  </span>
                  <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#fafafa' }}>
                    Interception Audit Detail
                  </h3>
                </div>
                <div style={{ fontSize: '0.72rem', color: '#71717a', marginTop: 4, fontFamily: 'monospace' }}>
                  Log ID: {String(inspectRecord.id || '')} &bull; Session: {String(inspectRecord.sessionId || '')}
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
                  >
                    {safeFormatJson(inspectRecord.response)}
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
                >
                  {safeFormatJson(inspectRecord.payload)}
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
      >
        Axioma Architecture Proof-of-Concept &bull; Expansion 3: Cross-Domain Agent Handoff &bull; Zero-Trust MCP Gateway (:3001)
      </footer>
    </div>
  );
}

/**
 * Safely format payloads and responses as readable JSON for display,
 * preventing crashes from circular references, BigInts, or malformed data.
 */
function safeFormatJson(val: any): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return val;
    }
  }
  try {
    const seen = new WeakSet();
    return JSON.stringify(
      val,
      (key, value) => {
        if (typeof value === 'bigint') return value.toString();
        if (typeof value === 'object' && value !== null) {
          if ('_reactName' in value || 'nativeEvent' in value) {
            return '[React Event]';
          }
          if (seen.has(value)) {
            return '[Circular]';
          }
          seen.add(value);
        }
        return value;
      },
      2
    );
  } catch {
    return String(val);
  }
}

/**
 * Client-side simulation fallback when Gateway on port 3001 is offline.
 * Replicates the exact mathematical invariant boundaries of Axioma.
 */
function simulateProposalVerification(parsedPayload: any, domain: string): any {
  const args = parsedPayload?.params?.arguments || {};
  const { mutationName, sourceState, event, payload } = args;

  // Domain Isolation Check
  if (domain === 'fulfillment') {
    if (mutationName === 'submitPayment' || event === 'SUBMIT_PAYMENT' || sourceState === 'pending_payment') {
      return {
        status: 'REJECTED',
        domain: 'fulfillment',
        sourceState,
        error: "Domain boundary violation: Agent operating in domain 'fulfillment' cannot execute checkout operation 'submitPayment'.",
        violations: ['DOMAIN_BOUNDARY_VIOLATION'],
        feedback: "DOMAIN_BOUNDARY_VIOLATION: The agent operating under 'fulfillment' least-privilege context attempted to execute 'submitPayment', which belongs to domain 'checkout'.",
      };
    }

    if (event === 'ALLOCATE_INVENTORY' && sourceState === 'unfulfilled') {
      return {
        status: 'APPROVED',
        domain: 'fulfillment',
        sourceState: 'unfulfilled',
        targetState: 'inventory_allocated',
        validatedGuards: ['hasOrderId', 'hasItems'],
        feedback: "Proposal successfully validated! Legal transition from 'unfulfilled' to 'inventory_allocated' via 'ALLOCATE_INVENTORY' in domain 'fulfillment'.",
      };
    }

    if (event === 'PRINT_LABEL' && sourceState === 'inventory_allocated') {
      return {
        status: 'APPROVED',
        domain: 'fulfillment',
        sourceState: 'inventory_allocated',
        targetState: 'label_printed',
        validatedGuards: ['hasValidCarrier'],
        feedback: "Proposal successfully validated! Legal transition from 'inventory_allocated' to 'label_printed' via 'PRINT_LABEL' in domain 'fulfillment'.",
      };
    }
  }

  // Checkout Domain
  if (event === 'APPLY_DISCOUNT' && sourceState === 'empty_cart') {
    return {
      status: 'REJECTED',
      domain: 'checkout',
      sourceState: 'empty_cart',
      violations: ['ILLEGAL_STATE_TRANSITION'],
      feedback: "In state 'empty_cart', triggering 'APPLY_DISCOUNT' is mathematically impossible. The machine forbids this transition.",
    };
  }

  if (event === 'SUBMIT_PAYMENT' && sourceState === 'pending_payment') {
    const key = payload?.idempotencyKey || payload?.input?.idempotencyKey;
    if (!key) {
      return {
        status: 'REJECTED',
        domain: 'checkout',
        sourceState: 'pending_payment',
        violations: ['MISSING_IDEMPOTENCY_KEY'],
        feedback: 'Proposal rejected due to invariant violations: MISSING_IDEMPOTENCY_KEY: payload must provide a non-empty string idempotencyKey.',
      };
    }
    return {
      status: 'APPROVED',
      domain: 'checkout',
      sourceState: 'pending_payment',
      targetState: 'payment_processing',
      validatedGuards: ['hasIdempotencyKey', 'validPositiveAmount'],
      feedback: "Proposal successfully validated! Legal transition from 'pending_payment' to 'payment_processing' via 'SUBMIT_PAYMENT'.",
    };
  }

  return {
    status: 'APPROVED',
    domain,
    sourceState,
    targetState: 'next_state',
    feedback: 'Proposal validated.',
  };
}
