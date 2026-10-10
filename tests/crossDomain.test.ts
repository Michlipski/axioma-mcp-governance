import { test, describe } from 'node:test';
import assert from 'node:assert';
import { createActor } from 'xstate';
import { fulfillmentMachine, createFulfillmentActor } from '../src/machines/fulfillmentMachine';
import { AxiomaMCPServer, createAxiomaMcpServer } from '../src/mcp/server';
import { extractMetadata } from '../src/gateway/server';

describe('Expansion 3: Cross-Domain Agent Handoff & Least-Privilege Governance', () => {
  const mcp = new AxiomaMCPServer();

  describe('Fulfillment State Machine Formal Invariants', () => {
    test('Axiom F1: SUBMIT_PAYMENT transition does not exist in fulfillmentMachine (mathematically impossible)', () => {
      const actor = createActor(fulfillmentMachine);
      actor.start();
      assert.strictEqual(actor.getSnapshot().value, 'unfulfilled');

      // Attempt payment submission on fulfillment machine
      actor.send({
        type: 'SUBMIT_PAYMENT' as any,
        idempotencyKey: 'idem_rogue_1',
        amountCents: 5000,
      } as any);

      // State remains strictly unfulfilled; event is mathematically unhandled
      assert.strictEqual(actor.getSnapshot().value, 'unfulfilled');
    });

    test('Axiom F2: Complete legal lifecycle unfulfilled -> inventory_allocated -> label_printed -> in_transit', () => {
      const actor = createFulfillmentActor('unfulfilled', { orderId: 'ord_9981' });
      assert.strictEqual(actor.getSnapshot().value, 'unfulfilled');

      // Step 1: Allocate inventory
      actor.send({
        type: 'ALLOCATE_INVENTORY',
        orderId: 'ord_9981',
        items: [{ sku: 'SKU-001', quantity: 2 }],
      });
      assert.strictEqual(actor.getSnapshot().value, 'inventory_allocated');
      assert.strictEqual(actor.getSnapshot().context.items.length, 1);

      // Step 2: Print shipping label
      actor.send({
        type: 'PRINT_LABEL',
        carrier: 'FedEx Ground',
      });
      assert.strictEqual(actor.getSnapshot().value, 'label_printed');
      assert.strictEqual(actor.getSnapshot().context.carrier, 'FedEx Ground');

      // Step 3: Dispatch shipment
      actor.send({
        type: 'DISPATCH_SHIPMENT',
        trackingNumber: 'TRK-FEDEX-9981',
      });
      assert.strictEqual(actor.getSnapshot().value, 'in_transit');
      assert.strictEqual(actor.getSnapshot().context.trackingNumber, 'TRK-FEDEX-9981');
      assert.strictEqual(actor.getSnapshot().status, 'done');
    });

    test('Axiom F3: Guard blocks PRINT_LABEL without carrier', () => {
      const actor = createFulfillmentActor('inventory_allocated', { orderId: 'ord_9981' });
      actor.send({
        type: 'PRINT_LABEL',
        carrier: '   ',
      });
      // Stays in inventory_allocated due to empty carrier guard
      assert.strictEqual(actor.getSnapshot().value, 'inventory_allocated');
    });
  });

  describe('Fulfillment Domain GraphQL Schema Boundaries', () => {
    test('Resource: fulfillment schema contains strictly shipping and inventory entities, omitting payment and cart', () => {
      const schema = mcp.getGraphQLSchema('fulfillment');

      // Must have fulfillment entities
      assert.ok(schema.includes('type InventoryItem'), 'Must contain InventoryItem');
      assert.ok(schema.includes('type ShippingPackage'), 'Must contain ShippingPackage');
      assert.ok(schema.includes('type FulfillmentJob'), 'Must contain FulfillmentJob');
      assert.ok(schema.includes('allocateInventory'), 'Must contain allocateInventory mutation');
      assert.ok(schema.includes('printShippingLabel'), 'Must contain printShippingLabel mutation');
      assert.ok(schema.includes('dispatchShipment'), 'Must contain dispatchShipment mutation');

      // Must strictly omit cart and payment entities
      assert.ok(!schema.includes('type Cart\n') && !schema.includes('type Cart {'), 'Must omit type Cart');
      assert.ok(!schema.includes('type CartItem'), 'Must omit type CartItem');
      assert.ok(!schema.includes('type PaymentTransaction'), 'Must omit type PaymentTransaction');
      assert.ok(!schema.includes('type PaymentResult'), 'Must omit type PaymentResult');
      assert.ok(!schema.includes('submitPayment'), 'Must omit submitPayment mutation');
    });

    test('Resource: fulfillment machine source is exposed via getStateMachineSource', () => {
      const source = mcp.getStateMachineSource('fulfillment');
      assert.ok(source.includes('fulfillmentMachine'));
      assert.ok(source.includes('unfulfilled'));
      assert.ok(source.includes('inventory_allocated'));
    });
  });

  describe('Least-Privilege Context & Domain Isolation Enforcement', () => {
    test('Call A (Cross-domain violation): agent-fulfillment-worker attempting SUBMIT_PAYMENT is REJECTED with DOMAIN_BOUNDARY_VIOLATION', () => {
      const proposal = {
        domain: 'fulfillment' as const,
        mutationName: 'submitPayment',
        sourceState: 'pending_payment',
        event: 'SUBMIT_PAYMENT',
        payload: {
          orderId: 'ord_9981',
          idempotencyKey: 'idem_rogue_worker',
          amountCents: 5000,
        },
        implementationCode: '// Rogue fulfillment worker trying to bypass payment gateway',
      };

      const result = mcp.proposeResolver(proposal);
      assert.strictEqual(result.status, 'REJECTED');
      assert.strictEqual(result.domain, 'fulfillment');
      assert.ok(result.violations?.includes('DOMAIN_BOUNDARY_VIOLATION'), 'Must include DOMAIN_BOUNDARY_VIOLATION violation');
      assert.ok(result.error?.includes('Domain boundary violation'));
    });

    test('Call B (Valid legal step): agent-fulfillment-worker attempting ALLOCATE_INVENTORY on unfulfilled is APPROVED', () => {
      const proposal = {
        domain: 'fulfillment' as const,
        mutationName: 'allocateInventory',
        sourceState: 'unfulfilled',
        event: 'ALLOCATE_INVENTORY',
        payload: {
          orderId: 'ord_9981',
          items: [{ sku: 'SKU-001', quantity: 1 }],
        },
        implementationCode: `
          const [job] = await db.insert(schema.fulfillmentJobs).values({
            orderId: payload.orderId,
            status: 'QUEUED',
          }).returning();
          return job;
        `,
      };

      const result = mcp.proposeResolver(proposal);
      assert.strictEqual(result.status, 'APPROVED');
      assert.strictEqual(result.domain, 'fulfillment');
      assert.strictEqual(result.sourceState, 'unfulfilled');
      assert.strictEqual(result.targetState, 'inventory_allocated');
      assert.ok(result.validatedGuards?.includes('hasOrderId'));
      assert.ok(result.feedback.includes('Legal transition'));
    });

    test('Call C (Reverse boundary check): checkout domain agent attempting allocateInventory is REJECTED with DOMAIN_BOUNDARY_VIOLATION', () => {
      const proposal = {
        domain: 'checkout' as const,
        mutationName: 'allocateInventory',
        sourceState: 'paid',
        event: 'ALLOCATE_INVENTORY',
        payload: { orderId: 'ord_9981' },
        implementationCode: '// Checkout trying to touch fulfillment domain directly',
      };

      const result = mcp.proposeResolver(proposal);
      assert.strictEqual(result.status, 'REJECTED');
      assert.ok(result.violations?.includes('DOMAIN_BOUNDARY_VIOLATION'));
    });

    test('Introspect State Boundary enforces fulfillment domain invariants', () => {
      const introspection = mcp.introspectStateBoundary('unfulfilled', 'fulfillment');
      assert.strictEqual(introspection.domain, 'fulfillment');
      assert.strictEqual(introspection.state, 'unfulfilled');
      assert.deepStrictEqual(introspection.admissibleEvents, ['ALLOCATE_INVENTORY']);
      assert.ok(introspection.invariants.some((inv) => inv.includes('SUBMIT_PAYMENT is cross-domain')));
    });

    test('Gateway metadata extraction correctly infers fulfillment domain from headers or agent ID', () => {
      const headers = {
        'x-agent-id': 'agent-fulfillment-worker',
        'x-domain': 'fulfillment',
      };
      const meta = extractMetadata(headers as any, {});
      assert.strictEqual(meta.agentId, 'agent-fulfillment-worker');
      assert.strictEqual(meta.domain, 'fulfillment');

      // Without header, infers from agent ID
      const metaInferred = extractMetadata({ 'x-agent-id': 'agent-fulfillment-worker' } as any, {});
      assert.strictEqual(metaInferred.domain, 'fulfillment');
    });
  });
});
