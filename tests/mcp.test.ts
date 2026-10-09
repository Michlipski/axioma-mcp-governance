import { test, describe } from 'node:test';
import assert from 'node:assert';
import { AxiomaMCPServer, createAxiomaMcpServer } from '../src/mcp/server';

describe('Axioma MCP Server - Governance & Tool Conformance', () => {
  const mcp = new AxiomaMCPServer();

  test('Resource: getGraphQLSchema returns complete strictly typed schema', () => {
    const schema = mcp.getGraphQLSchema();
    assert.ok(schema.includes('type Cart'));
    assert.ok(schema.includes('type PaymentResult'));
    assert.ok(schema.includes('submitPayment(orderId: ID!, input: PaymentInput!): PaymentResult!'));
  });

  test('Resource: getStateMachineSource returns raw XState TypeScript source', () => {
    const source = mcp.getStateMachineSource();
    assert.ok(source.includes('createMachine'));
    assert.ok(source.includes('empty_cart:'));
    assert.ok(source.includes('pending_payment:'));
    assert.ok(source.includes('isValidPaymentSubmission'));
  });

  test('Resource: getStateMachineJSON produces structural state-transition map', () => {
    const json = mcp.getStateMachineJSON() as any;
    assert.strictEqual(json.id, 'checkout');
    assert.strictEqual(json.initial, 'empty_cart');
    assert.ok(json.states.empty_cart);
    assert.deepStrictEqual(json.states.empty_cart.on, ['ADD_ITEM']);
    assert.ok(json.states.pending_payment.on.includes('SUBMIT_PAYMENT'));
  });

  test('Tool: introspectStateBoundary verifies empty_cart constraints', () => {
    const introspection = mcp.introspectStateBoundary('empty_cart');
    assert.strictEqual(introspection.state, 'empty_cart');
    assert.deepStrictEqual(introspection.admissibleEvents, ['ADD_ITEM']);
    assert.ok(introspection.invariants.some((inv) => inv.includes('SUBMIT_PAYMENT is unhandled')));
  });

  test('Tool: introspectStateBoundary verifies pending_payment constraints', () => {
    const introspection = mcp.introspectStateBoundary('pending_payment');
    assert.strictEqual(introspection.state, 'pending_payment');
    assert.ok(introspection.admissibleEvents.includes('SUBMIT_PAYMENT'));
    assert.ok(introspection.admissibleEvents.includes('CANCEL_CHECKOUT'));
    assert.ok(introspection.invariants.some((inv) => inv.includes('idempotencyKey')));
  });

  test('Governance Tool: propose_resolver mathematically rejects SUBMIT_PAYMENT from empty_cart', () => {
    const result = mcp.proposeResolver({
      mutationName: 'submitPayment',
      sourceState: 'empty_cart',
      event: 'SUBMIT_PAYMENT',
      payload: {
        orderId: 'ord_test_1',
        input: {
          idempotencyKey: 'idem_123',
          amountCents: 5000,
        },
      },
      implementationCode: `
        await db.insert(schema.paymentTransactions).values({ ... });
      `,
    });

    assert.strictEqual(result.status, 'REJECTED');
    assert.ok(result.violations?.includes('ILLEGAL_STATE_TRANSITION'));
    assert.ok(result.error?.includes("Event 'SUBMIT_PAYMENT' is not admissible from state 'empty_cart'"));
  });

  test('Governance Tool: propose_resolver rejects SUBMIT_PAYMENT with missing idempotency key', () => {
    const result = mcp.proposeResolver({
      mutationName: 'submitPayment',
      sourceState: 'pending_payment',
      event: 'SUBMIT_PAYMENT',
      payload: {
        orderId: 'ord_test_2',
        input: {
          amountCents: 5000,
        },
      },
      implementationCode: `
        const existing = await db.query.paymentTransactions.findFirst({ where: eq(schema.paymentTransactions.idempotencyKey, key) });
        await db.insert(schema.paymentTransactions).values({ ... });
        await db.update(schema.orders).set({ status: 'PAID' });
      `,
    });

    assert.strictEqual(result.status, 'REJECTED');
    assert.ok(result.violations?.some((v) => v.includes('MISSING_IDEMPOTENCY_KEY')));
  });

  test('Governance Tool: propose_resolver rejects non-existent GraphQL mutation name', () => {
    const result = mcp.proposeResolver({
      mutationName: 'arbitraryDirectDatabaseBypass',
      sourceState: 'pending_payment',
      event: 'SUBMIT_PAYMENT',
      payload: {
        orderId: 'ord_test_3',
        input: {
          idempotencyKey: 'idem_valid_key',
          amountCents: 5000,
        },
      },
      implementationCode: 'console.log("bypass");',
    });

    assert.strictEqual(result.status, 'REJECTED');
    assert.ok(result.violations?.includes('GRAPHQL_MUTATION_NOT_FOUND'));
  });

  test('Governance Tool: propose_resolver approves valid, strictly governed SUBMIT_PAYMENT proposal', () => {
    const result = mcp.proposeResolver({
      mutationName: 'submitPayment',
      sourceState: 'pending_payment',
      event: 'SUBMIT_PAYMENT',
      payload: {
        orderId: 'ord_valid_999',
        input: {
          idempotencyKey: 'idem_token_abc_123',
          amountCents: 5400,
          paymentToken: 'tok_stripe_test',
        },
      },
      implementationCode: `
        // Idempotency check
        const existingTransaction = await db.query.paymentTransactions.findFirst({
          where: eq(schema.paymentTransactions.idempotencyKey, input.idempotencyKey),
        });
        if (existingTransaction) return existingTransaction;

        // Project payment insert
        const [transaction] = await db
          .insert(schema.paymentTransactions)
          .values({
            id: crypto.randomUUID(),
            orderId,
            idempotencyKey: input.idempotencyKey,
            amountCents: input.amountCents,
            status: 'CAPTURED',
          })
          .returning();

        // Project order update to PAID
        await db
          .update(schema.orders)
          .set({ status: 'PAID', updatedAt: new Date() })
          .where(eq(schema.orders.id, orderId));
      `,
    });

    assert.strictEqual(result.status, 'APPROVED');
    assert.strictEqual(result.sourceState, 'pending_payment');
    assert.strictEqual(result.targetState, 'payment_processing');
    assert.ok(result.validatedGuards?.includes('hasIdempotencyKey'));
    assert.ok(result.validatedGuards?.includes('validPositiveAmount'));
    assert.ok(result.feedback.includes('Legal transition'));
  });

  test('createAxiomaMcpServer factory initializes McpServer with tools and resources', () => {
    const server = createAxiomaMcpServer();
    assert.ok(server);
  });
});
