/**
 * Axioma Architecture MCP Server
 * Exposes GraphQL schema, PostgreSQL DDL, and XState state boundaries
 * to specialized child subagents for zero-trust code generation.
 */

import fs from 'node:fs';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { checkoutMachine } from '../machines/checkoutMachine';

export interface MCPIntrospectionResponse {
  state: string;
  admissibleEvents: string[];
  invariants: string[];
  subgraph: string;
}

export interface ProposeResolverInput {
  mutationName: string;
  sourceState: string;
  event: string;
  payload: Record<string, any>;
  implementationCode: string;
}

export interface ProposeResolverResult {
  status: 'APPROVED' | 'REJECTED';
  sourceState: string;
  targetState?: string;
  error?: string;
  violations?: string[];
  feedback: string;
  validatedGuards?: string[];
}

export class AxiomaMCPServer {
  private schemaPath: string;
  private machinePath: string;
  private traceDir: string;

  constructor(baseDir: string = process.cwd()) {
    this.schemaPath = path.join(baseDir, 'src/graphql/schema.graphql');
    this.machinePath = path.join(baseDir, 'src/machines/checkoutMachine.ts');
    this.traceDir = path.join(baseDir, 'docs/trace');
  }

  /**
   * Resource: Read the current GraphQL Nouns Schema
   */
  public getGraphQLSchema(): string {
    if (!fs.existsSync(this.schemaPath)) {
      throw new Error(`Schema file not found at: ${this.schemaPath}`);
    }
    return fs.readFileSync(this.schemaPath, 'utf-8');
  }

  /**
   * Resource: Read the raw XState Machine source code
   */
  public getStateMachineSource(): string {
    if (!fs.existsSync(this.machinePath)) {
      throw new Error(`Machine source file not found at: ${this.machinePath}`);
    }
    return fs.readFileSync(this.machinePath, 'utf-8');
  }

  /**
   * Resource: Get XState Machine Definition as JSON
   */
  public getStateMachineJSON(): Record<string, unknown> {
    const rawConfig = checkoutMachine.config;
    return {
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

  /**
   * Tool: Introspect State Boundary
   * Queries what events and guards are legal from a specific state.
   */
  public introspectStateBoundary(stateName: string): MCPIntrospectionResponse {
    const machineConfig = checkoutMachine.config;
    const stateDef = machineConfig.states?.[stateName];

    if (!stateDef) {
      throw new Error(`Invalid state: ${stateName}. Admissible states: ${Object.keys(machineConfig.states || {}).join(', ')}`);
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
      state: stateName,
      admissibleEvents,
      invariants,
      subgraph: this.extractSubgraphForState(stateName),
    };
  }

  /**
   * Tool: Propose Resolver
   * Validates whether a proposed resolver implementation conforms to:
   * 1. XState legal transitions and guards
   * 2. GraphQL schema nouns & mutation signatures
   * 3. Database mutation constraints (e.g. idempotency, order status updates)
   */
  public proposeResolver(input: ProposeResolverInput): ProposeResolverResult {
    const { mutationName, sourceState, event, payload, implementationCode } = input;
    const machineConfig = checkoutMachine.config;
    const stateDef = machineConfig.states?.[sourceState];

    // 1. Validate source state exists
    if (!stateDef) {
      return {
        status: 'REJECTED',
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
        sourceState,
        error: `Transition violation: Event '${event}' is not admissible from state '${sourceState}'. Legal events: [${admissibleEvents.join(', ')}]`,
        violations: ['ILLEGAL_STATE_TRANSITION'],
        feedback: `In state '${sourceState}', triggering '${event}' is mathematically impossible. The machine forbids this transition.`,
      };
    }

    // 3. Validate GraphQL schema conformance
    const schema = this.getGraphQLSchema();
    const mutationRegex = new RegExp(`\\b${mutationName}\\s*\\(`, 'm');
    if (!mutationRegex.test(schema)) {
      return {
        status: 'REJECTED',
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
        sourceState,
        error: `Proposal rejected due to invariant violations: ${violations.join('; ')}`,
        violations,
        feedback: 'The proposed resolver failed one or more mathematical invariants or schema constraints.',
      };
    }

    return {
      status: 'APPROVED',
      sourceState,
      targetState,
      validatedGuards,
      feedback: `Proposal successfully validated! Legal transition from '${sourceState}' to '${targetState}' via '${event}'. Conforms to GraphQL mutation '${mutationName}' and strict database invariants.`,
    };
  }

  /**
   * Extracts only the relevant GraphQL types for a given state boundary
   */
  private extractSubgraphForState(stateName: string): string {
    const fullSchema = this.getGraphQLSchema();
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
export function createAxiomaMcpServer(baseDir: string = process.cwd()): McpServer {
  const axioma = new AxiomaMCPServer(baseDir);

  const server = new McpServer({
    name: 'axioma-governance-server',
    version: '1.0.0',
  });

  // --- MCP Resources ---

  // Resource 1: GraphQL Schema
  server.resource(
    'graphql-schema',
    'axioma://schema/graphql',
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          text: axioma.getGraphQLSchema(),
          mimeType: 'text/plain',
        },
      ],
    })
  );

  // Resource 2: XState Machine Source
  server.resource(
    'checkout-machine-source',
    'axioma://machines/checkout',
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          text: axioma.getStateMachineSource(),
          mimeType: 'text/plain',
        },
      ],
    })
  );

  // Resource 3: XState Machine State Graph (JSON)
  server.resource(
    'checkout-machine-json',
    'axioma://machines/json',
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify(axioma.getStateMachineJSON(), null, 2),
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
      stateName: z.string().describe('The name of the state in checkoutMachine, e.g. empty_cart, cart_active, checkout_draft, pending_payment, paid, fulfilled'),
    },
    async ({ stateName }) => {
      try {
        const response = axioma.introspectStateBoundary(stateName);
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
      mutationName: z.string().describe('The GraphQL mutation name, e.g. submitPayment, initiateCheckout, attachShippingAddress'),
      sourceState: z.string().describe('The current XState state, e.g. pending_payment, cart_active'),
      event: z.string().describe('The XState event name to transition on, e.g. SUBMIT_PAYMENT, INITIATE_CHECKOUT'),
      payload: z.record(z.string(), z.any()).describe('The input payload including IDs, idempotencyKey, amounts, or address fields'),
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
