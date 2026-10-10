/**
 * Axioma Architecture MCP Server
 * Exposes GraphQL schema, PostgreSQL DDL, and XState state boundaries
 * to specialized child subagents for zero-trust code generation.
 *
 * Supports Domain Routing & Least-Privilege Isolation:
 * - Domain: 'checkout' | 'fulfillment'
 * - Resource URIs:
 *   - axioma://domains/checkout/schema
 *   - axioma://domains/checkout/state
 *   - axioma://domains/fulfillment/schema
 *   - axioma://domains/fulfillment/state
 */

import fs from 'node:fs';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { checkoutMachine } from '../machines/checkoutMachine';
import { fulfillmentMachine } from '../machines/fulfillmentMachine';

export type DomainName = 'checkout' | 'fulfillment';

export interface MCPIntrospectionResponse {
  domain: DomainName;
  state: string;
  admissibleEvents: string[];
  invariants: string[];
  subgraph: string;
}

export interface ProposeResolverInput {
  domain?: DomainName;
  mutationName: string;
  sourceState: string;
  event: string;
  payload: Record<string, any>;
  implementationCode: string;
}

export interface ProposeResolverResult {
  status: 'APPROVED' | 'REJECTED';
  domain?: DomainName;
  sourceState: string;
  targetState?: string;
  error?: string;
  violations?: string[];
  feedback: string;
  validatedGuards?: string[];
}

export class AxiomaMCPServer {
  private baseDir: string;
  private defaultDomain: DomainName;
  private schemaPaths: Record<DomainName, string>;
  private machinePaths: Record<DomainName, string>;
  private traceDir: string;

  constructor(baseDir: string = process.cwd(), defaultDomain: DomainName = 'checkout') {
    this.baseDir = baseDir;
    this.defaultDomain = defaultDomain;
    this.schemaPaths = {
      checkout: path.join(baseDir, 'src/graphql/schema.graphql'),
      fulfillment: path.join(baseDir, 'src/graphql/schema.fulfillment.graphql'),
    };
    this.machinePaths = {
      checkout: path.join(baseDir, 'src/machines/checkoutMachine.ts'),
      fulfillment: path.join(baseDir, 'src/machines/fulfillmentMachine.ts'),
    };
    this.traceDir = path.join(baseDir, 'docs/trace');
  }

  /**
   * Resource: Read GraphQL Nouns Schema for a given domain
   */
  public getGraphQLSchema(domain: DomainName = 'checkout'): string {
    const p = this.schemaPaths[domain] || this.schemaPaths.checkout;
    if (!fs.existsSync(p)) {
      throw new Error(`Schema file not found for domain '${domain}' at: ${p}`);
    }
    return fs.readFileSync(p, 'utf-8');
  }

  /**
   * Resource: Read the raw XState Machine source code for a given domain
   */
  public getStateMachineSource(domain: DomainName = 'checkout'): string {
    const p = this.machinePaths[domain] || this.machinePaths.checkout;
    if (!fs.existsSync(p)) {
      throw new Error(`Machine source file not found for domain '${domain}' at: ${p}`);
    }
    return fs.readFileSync(p, 'utf-8');
  }

  /**
   * Resource: Get XState Machine Definition as JSON for a given domain
   */
  public getStateMachineJSON(domain: DomainName = 'checkout'): Record<string, unknown> {
    const machine = domain === 'fulfillment' ? fulfillmentMachine : checkoutMachine;
    const rawConfig = machine.config;
    return {
      domain,
      id: rawConfig.id,
      initial: rawConfig.initial,
      states: Object.keys(rawConfig.states || {}).reduce<Record<string, unknown>>((acc, stateKey) => {
        const stateDef = rawConfig.states?.[stateKey];
        acc[stateKey] = {
          on: stateDef?.on ? Object.keys(stateDef.on) : [],
          type: stateDef?.type || 'atomic',
        };
        return acc;
      }, {}),
    };
  }

  private isFulfillmentState(stateName: string): boolean {
    return ['unfulfilled', 'inventory_allocated', 'label_printed', 'in_transit'].includes(stateName);
  }

  private isCheckoutState(stateName: string): boolean {
    return [
      'empty_cart',
      'cart_active',
      'checkout_draft',
      'pending_payment',
      'payment_processing',
      'payment_failed',
      'paid',
      'fulfilled',
    ].includes(stateName);
  }

  private isCheckoutMutation(mutationName: string): boolean {
    return [
      'createCart',
      'addItemToCart',
      'removeItemFromCart',
      'updateCartItemQuantity',
      'initiateCheckout',
      'applyDiscountCode',
      'removeDiscountCode',
      'attachShippingAddress',
      'submitPayment',
      'dispatchFulfillment',
    ].includes(mutationName);
  }

  private isFulfillmentMutation(mutationName: string): boolean {
    return ['allocateInventory', 'printShippingLabel', 'dispatchShipment'].includes(mutationName);
  }

  private isCheckoutEvent(event: string): boolean {
    return [
      'ADD_ITEM',
      'REMOVE_ITEM',
      'UPDATE_QUANTITY',
      'INITIATE_CHECKOUT',
      'APPLY_DISCOUNT',
      'REMOVE_DISCOUNT',
      'ATTACH_SHIPPING',
      'SUBMIT_PAYMENT',
      'PAYMENT_SUCCESS',
      'PAYMENT_ERROR',
      'RETRY_PAYMENT',
      'CANCEL_CHECKOUT',
      'DISPATCH_FULFILLMENT',
    ].includes(event);
  }

  private isFulfillmentEvent(event: string): boolean {
    return ['ALLOCATE_INVENTORY', 'PRINT_LABEL', 'DISPATCH_SHIPMENT', 'CANCEL_FULFILLMENT'].includes(event);
  }

  /**
   * Tool: Introspect State Boundary
   * Queries what events and guards are legal from a specific state.
   */
  public introspectStateBoundary(stateName: string, explicitDomain?: DomainName): MCPIntrospectionResponse {
    const domain: DomainName =
      explicitDomain ||
      (this.isFulfillmentState(stateName) ? 'fulfillment' : 'checkout');

    if (domain === 'fulfillment') {
      const machineConfig = fulfillmentMachine.config;
      const stateDef = machineConfig.states?.[stateName];

      if (!stateDef) {
        throw new Error(
          `Invalid fulfillment state: ${stateName}. Admissible states: ${Object.keys(machineConfig.states || {}).join(', ')}`
        );
      }

      const admissibleEvents = stateDef.on ? Object.keys(stateDef.on) : [];
      const invariants: string[] = [];

      if (stateName === 'unfulfilled') {
        invariants.push('Initial fulfillment state awaiting inventory allocation.');
        invariants.push('ALLOCATE_INVENTORY is the only admissible transition.');
        invariants.push('SUBMIT_PAYMENT is cross-domain and mathematically illegal.');
      } else if (stateName === 'inventory_allocated') {
        invariants.push('Stock is reserved in warehouse.');
        invariants.push('PRINT_LABEL requires valid carrier.');
        invariants.push('CANCEL_FULFILLMENT reverts to unfulfilled.');
      } else if (stateName === 'label_printed') {
        invariants.push('Shipping label generated and package queued for carrier.');
        invariants.push('DISPATCH_SHIPMENT requires valid tracking number.');
      } else if (stateName === 'in_transit') {
        invariants.push('Terminal state. Package is in custody of logistics carrier.');
      }

      return {
        domain: 'fulfillment',
        state: stateName,
        admissibleEvents,
        invariants,
        subgraph: this.extractSubgraphForState(stateName, 'fulfillment'),
      };
    }

    // Default: checkout domain
    const machineConfig = checkoutMachine.config;
    const stateDef = machineConfig.states?.[stateName];

    if (!stateDef) {
      throw new Error(
        `Invalid state: ${stateName}. Admissible states: ${Object.keys(machineConfig.states || {}).join(', ')}`
      );
    }

    const admissibleEvents = stateDef.on ? Object.keys(stateDef.on) : [];
    const invariants: string[] = [];

    if (stateName === 'empty_cart') {
      invariants.push('SUBMIT_PAYMENT is unhandled and mathematically illegal.');
      invariants.push('INITIATE_CHECKOUT is blocked until items are added.');
    } else if (stateName === 'cart_active') {
      invariants.push('Items can be added, updated, or removed.');
      invariants.push('INITIATE_CHECKOUT transitions to checkout_draft only if items exist.');
      invariants.push('SUBMIT_PAYMENT is unhandled and illegal.');
    } else if (stateName === 'checkout_draft') {
      invariants.push('Cart is locked for checkout.');
      invariants.push('ATTACH_SHIPPING requires complete recipient and address lines.');
      invariants.push('SUBMIT_PAYMENT cannot be called until shipping address is attached.');
    } else if (stateName === 'pending_payment') {
      invariants.push('SUBMIT_PAYMENT requires amountCents === totalCents.');
      invariants.push('idempotencyKey must be present, non-empty string.');
      invariants.push('Items count must be > 0 and totalCents > 0.');
    } else if (stateName === 'payment_processing') {
      invariants.push('Gateway transaction in-flight. Transitions only via PAYMENT_SUCCESS or PAYMENT_ERROR.');
    } else if (stateName === 'payment_failed') {
      invariants.push('Allows RETRY_PAYMENT back to pending_payment or CANCEL_CHECKOUT to cart_active.');
    } else if (stateName === 'paid') {
      invariants.push('Commercial contract settled and irreversible.');
      invariants.push('Transitions only to fulfilled via DISPATCH_FULFILLMENT with carrier and trackingNumber.');
    } else if (stateName === 'fulfilled') {
      invariants.push('Terminal state. No further transitions permitted.');
    }

    return {
      domain: 'checkout',
      state: stateName,
      admissibleEvents,
      invariants,
      subgraph: this.extractSubgraphForState(stateName, 'checkout'),
    };
  }

  /**
   * Tool: Propose Resolver
   * Validates whether a proposed resolver implementation conforms to:
   * 1. Least-Privilege Domain Isolation boundaries
   * 2. XState legal transitions and guards for the target domain
   * 3. GraphQL schema nouns & mutation signatures for the target domain
   * 4. Database mutation constraints (e.g. idempotency, status updates)
   */
  public proposeResolver(input: ProposeResolverInput): ProposeResolverResult {
    const { mutationName, sourceState, event, payload, implementationCode } = input;
    const domain: DomainName =
      input.domain ||
      (payload?._meta?.domain as DomainName) ||
      (payload?.domain as DomainName) ||
      (this.isFulfillmentState(sourceState) || this.isFulfillmentEvent(event) ? 'fulfillment' : this.defaultDomain);

    // 1. Cross-Domain Isolation Enforcement
    if (domain === 'fulfillment') {
      const attemptsCheckoutMutation = this.isCheckoutMutation(mutationName);
      const attemptsCheckoutEvent = this.isCheckoutEvent(event);
      const attemptsCheckoutState = this.isCheckoutState(sourceState);

      if (attemptsCheckoutMutation || attemptsCheckoutEvent || attemptsCheckoutState) {
        return {
          status: 'REJECTED',
          domain: 'fulfillment',
          sourceState,
          error: `Domain boundary violation: Agent operating in domain 'fulfillment' cannot execute checkout operation '${mutationName || event}'. Cross-domain tool calls are strictly forbidden under least-privilege governance.`,
          violations: ['DOMAIN_BOUNDARY_VIOLATION'],
          feedback: `DOMAIN_BOUNDARY_VIOLATION: The agent operating under 'fulfillment' least-privilege context attempted to execute '${mutationName || event}', which belongs to domain 'checkout'.`,
        };
      }
      return this.validateFulfillmentProposal(input);
    }

    if (domain === 'checkout') {
      const attemptsFulfillmentMutation = this.isFulfillmentMutation(mutationName);
      const attemptsFulfillmentEvent = this.isFulfillmentEvent(event) && event !== 'DISPATCH_FULFILLMENT';
      const attemptsFulfillmentState = this.isFulfillmentState(sourceState) && sourceState !== 'fulfilled';

      if (attemptsFulfillmentMutation || attemptsFulfillmentEvent || attemptsFulfillmentState) {
        return {
          status: 'REJECTED',
          domain: 'checkout',
          sourceState,
          error: `Domain boundary violation: Agent operating in domain 'checkout' cannot execute fulfillment operation '${mutationName || event}'.`,
          violations: ['DOMAIN_BOUNDARY_VIOLATION'],
          feedback: `DOMAIN_BOUNDARY_VIOLATION: Cross-domain call into fulfillment is forbidden for checkout agent.`,
        };
      }
      return this.validateCheckoutProposal(input);
    }

    return this.validateCheckoutProposal(input);
  }

  private validateFulfillmentProposal(input: ProposeResolverInput): ProposeResolverResult {
    const { mutationName, sourceState, event, payload } = input;
    const machineConfig = fulfillmentMachine.config;
    const stateDef = machineConfig.states?.[sourceState];

    if (!stateDef) {
      return {
        status: 'REJECTED',
        domain: 'fulfillment',
        sourceState,
        error: `State '${sourceState}' does not exist in fulfillmentMachine. Admissible states: ${Object.keys(machineConfig.states || {}).join(', ')}`,
        violations: ['UNKNOWN_SOURCE_STATE'],
        feedback: 'The agent attempted to transition from a non-existent state in the fulfillment domain.',
      };
    }

    const admissibleEvents = stateDef.on ? Object.keys(stateDef.on) : [];
    if (!admissibleEvents.includes(event)) {
      return {
        status: 'REJECTED',
        domain: 'fulfillment',
        sourceState,
        error: `Transition violation: Event '${event}' is not admissible from state '${sourceState}'. Legal events: [${admissibleEvents.join(', ')}]`,
        violations: ['ILLEGAL_STATE_TRANSITION'],
        feedback: `In fulfillment state '${sourceState}', triggering '${event}' is illegal. Admissible events: [${admissibleEvents.join(', ')}]`,
      };
    }

    const schema = this.getGraphQLSchema('fulfillment');
    const mutationRegex = new RegExp(`\\b${mutationName}\\s*\\(`, 'm');
    if (!mutationRegex.test(schema)) {
      return {
        status: 'REJECTED',
        domain: 'fulfillment',
        sourceState,
        error: `Schema violation: Mutation '${mutationName}' does not exist in schema.fulfillment.graphql.`,
        violations: ['GRAPHQL_MUTATION_NOT_FOUND'],
        feedback: `The agent proposed a mutation name '${mutationName}' that does not exist in the fulfillment GraphQL schema.`,
      };
    }

    const violations: string[] = [];
    const validatedGuards: string[] = [];
    let targetState = '';

    if (event === 'ALLOCATE_INVENTORY') {
      const orderId = payload?.orderId || payload?.input?.orderId;
      if (!orderId || typeof orderId !== 'string' || !orderId.trim()) {
        violations.push('MISSING_ORDER_ID: orderId is required to allocate inventory.');
      } else {
        validatedGuards.push('hasOrderId');
      }

      const items = payload?.items || payload?.input?.items;
      if (items && Array.isArray(items) && items.length === 0) {
        violations.push('EMPTY_ITEMS: cannot allocate inventory with 0 items.');
      } else {
        validatedGuards.push('hasItems');
      }

      targetState = 'inventory_allocated';
    } else if (event === 'PRINT_LABEL') {
      const carrier = payload?.carrier || payload?.input?.carrier;
      if (!carrier || typeof carrier !== 'string' || !carrier.trim()) {
        violations.push('MISSING_CARRIER: carrier is required to generate shipping label.');
      } else {
        validatedGuards.push('hasValidCarrier');
      }
      targetState = 'label_printed';
    } else if (event === 'DISPATCH_SHIPMENT') {
      const trackingNumber = payload?.trackingNumber || payload?.input?.trackingNumber;
      if (!trackingNumber || typeof trackingNumber !== 'string' || !trackingNumber.trim()) {
        violations.push('MISSING_TRACKING_NUMBER: trackingNumber is required to dispatch shipment.');
      } else {
        validatedGuards.push('hasValidTracking');
      }
      targetState = 'in_transit';
    } else {
      const transitionDef = (stateDef.on as any)?.[event];
      targetState = typeof transitionDef === 'string' ? transitionDef : (transitionDef as any)?.target || 'unknown';
    }

    if (violations.length > 0) {
      return {
        status: 'REJECTED',
        domain: 'fulfillment',
        sourceState,
        error: `Proposal rejected due to invariant violations: ${violations.join('; ')}`,
        violations,
        feedback: 'The proposed resolver failed one or more mathematical invariants in the fulfillment domain.',
      };
    }

    return {
      status: 'APPROVED',
      domain: 'fulfillment',
      sourceState,
      targetState,
      validatedGuards,
      feedback: `Proposal successfully validated! Legal transition from '${sourceState}' to '${targetState}' via '${event}' in domain 'fulfillment'. Conforms to GraphQL mutation '${mutationName}'.`,
    };
  }

  private validateCheckoutProposal(input: ProposeResolverInput): ProposeResolverResult {
    const { mutationName, sourceState, event, payload, implementationCode } = input;
    const machineConfig = checkoutMachine.config;
    const stateDef = machineConfig.states?.[sourceState];

    // 1. Validate source state exists
    if (!stateDef) {
      return {
        status: 'REJECTED',
        domain: 'checkout',
        sourceState,
        error: `State '${sourceState}' does not exist in checkoutMachine. Admissible states: ${Object.keys(machineConfig.states || {}).join(', ')}`,
        violations: ['UNKNOWN_SOURCE_STATE'],
        feedback: 'The agent attempted to transition from a non-existent state.',
      };
    }

    // 2. Validate event is admissible from source state
    const admissibleEvents = stateDef.on ? Object.keys(stateDef.on) : [];
    if (!admissibleEvents.includes(event)) {
      return {
        status: 'REJECTED',
        domain: 'checkout',
        sourceState,
        error: `Transition violation: Event '${event}' is not admissible from state '${sourceState}'. Legal events: [${admissibleEvents.join(', ')}]`,
        violations: ['ILLEGAL_STATE_TRANSITION'],
        feedback: `In state '${sourceState}', triggering '${event}' is mathematically impossible. The machine forbids this transition.`,
      };
    }

    // 3. Validate GraphQL schema conformance
    const schema = this.getGraphQLSchema('checkout');
    const mutationRegex = new RegExp(`\\b${mutationName}\\s*\\(`, 'm');
    if (!mutationRegex.test(schema)) {
      return {
        status: 'REJECTED',
        domain: 'checkout',
        sourceState,
        error: `Schema violation: Mutation '${mutationName}' does not exist in schema.graphql.`,
        violations: ['GRAPHQL_MUTATION_NOT_FOUND'],
        feedback: `The agent proposed a mutation name '${mutationName}' that violates the rigid GraphQL schema target.`,
      };
    }

    // 4. Validate specific state machine event guards & payload constraints
    const violations: string[] = [];
    const validatedGuards: string[] = [];
    let targetState = '';

    if (event === 'SUBMIT_PAYMENT') {
      const transitionDef = stateDef.on?.[event];
      targetState = typeof transitionDef === 'string' ? transitionDef : (transitionDef as any)?.target || 'payment_processing';

      // Guard check: Idempotency Key
      const key = payload?.idempotencyKey || payload?.input?.idempotencyKey;
      if (!key || typeof key !== 'string' || key.trim() === '') {
        violations.push('MISSING_IDEMPOTENCY_KEY: payload must provide a non-empty string idempotencyKey.');
      } else {
        validatedGuards.push('hasIdempotencyKey');
      }

      // Guard check: Amount matching
      const amount = payload?.amountCents ?? payload?.input?.amountCents;
      if (typeof amount !== 'number' || amount <= 0) {
        violations.push('INVALID_AMOUNT: amountCents must be a positive integer matching totalCents.');
      } else {
        validatedGuards.push('validPositiveAmount');
      }

      // Guard check: Order ID presence
      const orderId = payload?.orderId;
      if (!orderId && !payload?.input?.orderId) {
        violations.push('MISSING_ORDER_ID: orderId is required to bind payment to order.');
      }

      // Implementation code checks (verifying the AI didn't hallucinate or skip crucial steps)
      if (implementationCode) {
        const hasIdempotencyHandling = /idempotency|findFirst.*idempotencyKey|existingTransaction/i.test(implementationCode);
        const hasDbWrite = /insert\(.*paymentTransactions\)|update\(.*orders\)/i.test(implementationCode);
        const hasStatusPaid = /PAID|CAPTURED/i.test(implementationCode);

        if (!hasIdempotencyHandling) {
          violations.push('MISSING_IDEMPOTENCY_CHECK_IN_CODE: implementation must query for existing idempotency key before inserting.');
        }
        if (!hasDbWrite) {
          violations.push('MISSING_DATABASE_MUTATION: implementation must write payment transaction and update order.');
        }
        if (!hasStatusPaid) {
          violations.push('INCORRECT_ORDER_STATUS: implementation must update order status to PAID / CAPTURED upon success.');
        }
      }
    } else if (event === 'ATTACH_SHIPPING') {
      const address = payload?.address || payload?.input;
      if (!address?.recipientName || !address?.addressLine1 || !address?.city || !address?.postalCode || !address?.country) {
        violations.push('INCOMPLETE_SHIPPING_ADDRESS: recipientName, addressLine1, city, postalCode, and country are required.');
      } else {
        validatedGuards.push('isValidShippingAddress');
      }
      targetState = 'pending_payment';
    } else if (event === 'INITIATE_CHECKOUT') {
      const itemCount = payload?.itemCount ?? payload?.items?.length ?? 1;
      if (itemCount <= 0) {
        violations.push('EMPTY_CART: cannot initiate checkout with 0 items.');
      } else {
        validatedGuards.push('hasItems');
      }
      targetState = 'checkout_draft';
    } else if (event === 'APPLY_DISCOUNT') {
      const code = payload?.code || payload?.discountCode;
      if (!code || typeof code !== 'string' || code.trim() === '') {
        violations.push('MISSING_DISCOUNT_CODE: code must be a non-empty string.');
      } else {
        validatedGuards.push('hasValidDiscountCode');
      }
      targetState = 'checkout_draft';
    } else if (event === 'REMOVE_DISCOUNT') {
      targetState = 'checkout_draft';
    } else if (event === 'DISPATCH_FULFILLMENT') {
      const trackingNumber = payload?.trackingNumber;
      const carrier = payload?.carrier;
      if (!trackingNumber || !carrier) {
        violations.push('MISSING_FULFILLMENT_DATA: trackingNumber and carrier are required.');
      } else {
        validatedGuards.push('hasValidTracking');
      }
      targetState = 'fulfilled';
    } else {
      const transitionDef = (stateDef.on as any)?.[event];
      targetState = typeof transitionDef === 'string' ? transitionDef : (transitionDef as any)?.target || 'unknown';
    }

    if (violations.length > 0) {
      return {
        status: 'REJECTED',
        domain: 'checkout',
        sourceState,
        error: `Proposal rejected due to invariant violations: ${violations.join('; ')}`,
        violations,
        feedback: 'The proposed resolver failed one or more mathematical invariants or schema constraints.',
      };
    }

    return {
      status: 'APPROVED',
      domain: 'checkout',
      sourceState,
      targetState,
      validatedGuards,
      feedback: `Proposal successfully validated! Legal transition from '${sourceState}' to '${targetState}' via '${event}'. Conforms to GraphQL mutation '${mutationName}' and strict database invariants.`,
    };
  }

  /**
   * Extracts only the relevant GraphQL types for a given state boundary
   */
  private extractSubgraphForState(stateName: string, domain: DomainName = 'checkout'): string {
    if (domain === 'fulfillment') {
      return `Domain: Fulfillment. Types: InventoryItem, FulfillmentItem, ShippingPackage, FulfillmentJob. Mutations: allocateInventory, printShippingLabel, dispatchShipment`;
    }
    const fullSchema = this.getGraphQLSchema('checkout');
    if (stateName === 'empty_cart' || stateName === 'cart_active') {
      return `Types: Cart, CartItem, AddItemInput. Mutations: addItemToCart, removeItemFromCart, initiateCheckout`;
    }
    if (stateName === 'checkout_draft' || stateName === 'pending_payment') {
      return `Types: Order, OrderLineItem, ShippingAddress, ShippingAddressInput, PaymentInput. Mutations: attachShippingAddress, applyDiscountCode, removeDiscountCode, submitPayment`;
    }
    if (stateName === 'paid') {
      return `Types: Order, FulfillmentJob. Mutations: dispatchFulfillment`;
    }
    return fullSchema;
  }
}

/**
 * Creates and configures a Model Context Protocol (MCP) Server instance
 * exposing Axioma's architecture as read-only resources and governance tools.
 */
export function createAxiomaMcpServer(baseDir: string = process.cwd(), defaultDomain: DomainName = 'checkout'): McpServer {
  const axioma = new AxiomaMCPServer(baseDir, defaultDomain);

  const server = new McpServer({
    name: 'axioma-governance-server',
    version: '1.0.0',
  });

  // --- Domain-Scoped MCP Resources ---

  // Resource 1: Fulfillment GraphQL Schema
  server.resource(
    'fulfillment-graphql-schema',
    'axioma://domains/fulfillment/schema',
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          text: axioma.getGraphQLSchema('fulfillment'),
          mimeType: 'text/plain',
        },
      ],
    })
  );

  // Resource 2: Fulfillment State Machine Source
  server.resource(
    'fulfillment-machine-source',
    'axioma://domains/fulfillment/state',
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          text: axioma.getStateMachineSource('fulfillment'),
          mimeType: 'text/plain',
        },
      ],
    })
  );

  // Resource 3: Checkout Domain GraphQL Schema
  server.resource(
    'checkout-domain-graphql-schema',
    'axioma://domains/checkout/schema',
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          text: axioma.getGraphQLSchema('checkout'),
          mimeType: 'text/plain',
        },
      ],
    })
  );

  // Resource 4: Checkout Domain State Machine Source
  server.resource(
    'checkout-domain-machine-source',
    'axioma://domains/checkout/state',
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          text: axioma.getStateMachineSource('checkout'),
          mimeType: 'text/plain',
        },
      ],
    })
  );

  // Legacy Resource: GraphQL Schema
  server.resource(
    'graphql-schema',
    'axioma://schema/graphql',
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          text: axioma.getGraphQLSchema('checkout'),
          mimeType: 'text/plain',
        },
      ],
    })
  );

  // Legacy Resource: XState Machine Source
  server.resource(
    'checkout-machine-source',
    'axioma://machines/checkout',
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          text: axioma.getStateMachineSource('checkout'),
          mimeType: 'text/plain',
        },
      ],
    })
  );

  // Legacy Resource: XState Machine State Graph (JSON)
  server.resource(
    'checkout-machine-json',
    'axioma://machines/json',
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify(axioma.getStateMachineJSON('checkout'), null, 2),
          mimeType: 'application/json',
        },
      ],
    })
  );

  // --- MCP Tools ---

  // Tool 1: Introspect State Boundary
  server.tool(
    'introspect_state',
    {
      stateName: z.string().describe('The name of the state, e.g. empty_cart, pending_payment, unfulfilled, inventory_allocated'),
      domain: z.enum(['checkout', 'fulfillment']).optional().describe('Optional domain context filter'),
    },
    async ({ stateName, domain }) => {
      try {
        const response = axioma.introspectStateBoundary(stateName, domain);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(response, null, 2),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Error introspecting state: ${err.message}`,
            },
          ],
        };
      }
    }
  );

  // Tool 2: Propose Resolver
  server.tool(
    'propose_resolver',
    {
      domain: z.enum(['checkout', 'fulfillment']).optional().describe('The domain scope: checkout or fulfillment'),
      mutationName: z.string().describe('The GraphQL mutation name, e.g. submitPayment, allocateInventory'),
      sourceState: z.string().describe('The current XState state, e.g. pending_payment, unfulfilled'),
      event: z.string().describe('The XState event name to transition on, e.g. SUBMIT_PAYMENT, ALLOCATE_INVENTORY'),
      payload: z.record(z.string(), z.any()).describe('The input payload including IDs, idempotencyKey, amounts, or items'),
      implementationCode: z.string().describe('The TypeScript/Drizzle/PostgreSQL code implementing the mutation resolver'),
    },
    async (input) => {
      const result = axioma.proposeResolver(input);
      return {
        isError: result.status === 'REJECTED',
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  return server;
}
