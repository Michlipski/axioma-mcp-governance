import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { AxiomaMCPServer } from '../src/mcp/server';
import { createCheckoutActor } from '../src/graphql/resolvers';

describe('Ephemeral Test Sandbox - Mutation & Resolver Governance Verification', () => {
  const mcp = new AxiomaMCPServer();
  const proposalPath = path.join(process.cwd(), 'scratch/proposal.json');

  test('Sandbox: Verified proposal exists in scratch/proposal.json', () => {
    assert.ok(fs.existsSync(proposalPath), 'scratch/proposal.json must exist in the workspace');
  });

  test('Sandbox: Propose resolver passes strict mathematical state invariants', () => {
    const raw = fs.readFileSync(proposalPath, 'utf-8');
    const proposal = JSON.parse(raw);

    const result = mcp.proposeResolver(proposal);
    assert.strictEqual(
      result.status,
      'APPROVED',
      `Proposal failed formal verification: ${result.error || result.violations?.join(', ')}`
    );
    assert.strictEqual(result.sourceState, 'pending_payment');
    assert.strictEqual(result.targetState, 'payment_processing');
  });

  test('Sandbox: Database mutation adheres to idempotency and state machine transitions', () => {
    const raw = fs.readFileSync(proposalPath, 'utf-8');
    const proposal = JSON.parse(raw);

    // Verify code syntax and AST safeguards
    const code = proposal.implementationCode;
    assert.ok(
      /idempotency/i.test(code),
      'Sandbox check failed: Proposed resolver code must verify idempotency key'
    );
    assert.ok(
      /insert\(.*paymentTransactions\)/i.test(code),
      'Sandbox check failed: Proposed resolver code must insert into paymentTransactions'
    );
    assert.ok(
      /update\(.*orders\)/i.test(code),
      'Sandbox check failed: Proposed resolver code must update order status'
    );
    assert.ok(
      /PAID/i.test(code),
      'Sandbox check failed: Proposed resolver code must set order status to PAID'
    );

    // Verify actor state projection with legal context (items, non-zero total, idempotency)
    const actor = createCheckoutActor('pending_payment', {
      cartId: 'sandbox_cart_1',
      items: [
        {
          id: 'item_sandbox_1',
          productId: 'prod_1',
          sku: 'SKU-PROD-1',
          title: 'Axioma Verified Item',
          unitPriceCents: proposal.payload.input.amountCents,
          quantity: 1,
        },
      ],
      subtotalCents: proposal.payload.input.amountCents,
      totalCents: proposal.payload.input.amountCents,
    });

    actor.send({
      type: 'SUBMIT_PAYMENT',
      idempotencyKey: proposal.payload.input.idempotencyKey,
      amountCents: proposal.payload.input.amountCents,
    });

    assert.strictEqual(
      actor.getSnapshot().value,
      'payment_processing',
      'Actor failed to transition to payment_processing'
    );

    // Transition to paid
    actor.send({
      type: 'PAYMENT_SUCCESS',
      paymentId: 'pay_sandbox_123',
    });

    assert.strictEqual(
      actor.getSnapshot().value,
      'paid',
      'Actor failed to transition to paid upon PAYMENT_SUCCESS'
    );
  });
});
