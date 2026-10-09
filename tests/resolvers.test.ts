import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { ApolloServer } from '@apollo/server';
import { createCheckoutActor, resolvers, DateTimeScalar } from '../src/graphql/resolvers';

describe('Apollo GraphQL Resolvers & Zero-Trust State Machine Enforcement', () => {
  const schemaPath = path.join(process.cwd(), 'src/graphql/schema.graphql');
  const typeDefs = fs.readFileSync(schemaPath, 'utf-8');

  test('ApolloServer initializes successfully with schema.graphql and resolvers', () => {
    const server = new ApolloServer({
      typeDefs,
      resolvers,
    });
    assert.ok(server);
  });

  test('DateTime scalar correctly serializes and parses dates', () => {
    const now = new Date('2026-10-08T12:00:00.000Z');
    assert.strictEqual(DateTimeScalar.serialize(now), '2026-10-08T12:00:00.000Z');
    assert.strictEqual(
      DateTimeScalar.serialize('2026-10-08T12:00:00.000Z'),
      '2026-10-08T12:00:00.000Z'
    );
    const parsed = DateTimeScalar.parseValue('2026-10-08T12:00:00.000Z');
    assert.ok(parsed instanceof Date);
    assert.strictEqual((parsed as Date).toISOString(), '2026-10-08T12:00:00.000Z');
  });

  test('Field Resolvers: CartItem totalCents fallback and computation', () => {
    const cartItemResolver = resolvers.CartItem;
    assert.strictEqual(
      cartItemResolver.totalCents({ unitPriceCents: 2500, quantity: 3 }),
      7500
    );
    assert.strictEqual(
      cartItemResolver.totalCents({ unitPriceCents: 2500, quantity: 3, totalCents: 7500 }),
      7500
    );
  });

  test('Zero-Trust Projection: empty_cart rejects INITIATE_CHECKOUT and SUBMIT_PAYMENT', () => {
    const actor = createCheckoutActor('empty_cart', { cartId: 'c1', items: [] });
    assert.strictEqual(actor.getSnapshot().value, 'empty_cart');

    actor.send({ type: 'INITIATE_CHECKOUT' });
    assert.strictEqual(actor.getSnapshot().value, 'empty_cart');

    actor.send({
      type: 'SUBMIT_PAYMENT',
      idempotencyKey: 'idem_test',
      amountCents: 100,
    });
    assert.strictEqual(actor.getSnapshot().value, 'empty_cart');
  });

  test('Zero-Trust Projection: ADD_ITEM transitions empty_cart to cart_active', () => {
    const actor = createCheckoutActor('empty_cart', { cartId: 'c1', items: [] });
    actor.send({
      type: 'ADD_ITEM',
      item: {
        id: 'item_1',
        productId: 'prod_1',
        sku: 'SKU-1',
        title: 'Product 1',
        unitPriceCents: 1000,
        quantity: 2,
      },
    });

    const snapshot = actor.getSnapshot();
    assert.strictEqual(snapshot.value, 'cart_active');
    assert.strictEqual(snapshot.context.items.length, 1);
    assert.strictEqual(snapshot.context.subtotalCents, 2000);
    assert.strictEqual(snapshot.context.taxCents, 160);
    assert.strictEqual(snapshot.context.totalCents, 2160);
  });

  test('Zero-Trust Projection: cart_active initiates checkout to checkout_draft', () => {
    const actor = createCheckoutActor('cart_active', {
      cartId: 'c1',
      items: [
        {
          id: 'item_1',
          productId: 'prod_1',
          sku: 'SKU-1',
          title: 'Product 1',
          unitPriceCents: 1000,
          quantity: 2,
        },
      ],
      subtotalCents: 2000,
      taxCents: 160,
      totalCents: 2160,
    });

    actor.send({ type: 'INITIATE_CHECKOUT' });
    const snapshot = actor.getSnapshot();
    assert.strictEqual(snapshot.value, 'checkout_draft');
  });

  test('Zero-Trust Projection: checkout_draft transitions to pending_payment only with valid shipping address', () => {
    const actor = createCheckoutActor('checkout_draft', {
      cartId: 'c1',
      items: [
        {
          id: 'item_1',
          productId: 'prod_1',
          sku: 'SKU-1',
          title: 'Product 1',
          unitPriceCents: 1000,
          quantity: 2,
        },
      ],
      subtotalCents: 2000,
      taxCents: 160,
      totalCents: 2160,
    });

    // Invalid shipping (missing recipientName)
    actor.send({
      type: 'ATTACH_SHIPPING',
      address: {
        recipientName: '',
        addressLine1: '123 Main St',
        city: 'City',
        postalCode: '12345',
        country: 'US',
      },
    });
    assert.strictEqual(actor.getSnapshot().value, 'checkout_draft');

    // Valid shipping
    actor.send({
      type: 'ATTACH_SHIPPING',
      address: {
        recipientName: 'Alice Smith',
        addressLine1: '123 Main St',
        city: 'City',
        postalCode: '12345',
        country: 'US',
      },
      shippingCents: 500,
    });
    const snapshot = actor.getSnapshot();
    assert.strictEqual(snapshot.value, 'pending_payment');
    assert.strictEqual(snapshot.context.shippingCents, 500);
    assert.strictEqual(snapshot.context.totalCents, 2000 + 500 + 160);
  });

  test('Zero-Trust Projection: pending_payment requires exact amount match to transition', () => {
    const actor = createCheckoutActor('pending_payment', {
      cartId: 'c1',
      items: [
        {
          id: 'item_1',
          productId: 'prod_1',
          sku: 'SKU-1',
          title: 'Product 1',
          unitPriceCents: 1000,
          quantity: 2,
        },
      ],
      subtotalCents: 2000,
      shippingCents: 500,
      taxCents: 160,
      totalCents: 2660,
    });

    // Mismatched amount
    actor.send({
      type: 'SUBMIT_PAYMENT',
      idempotencyKey: 'idem_key_1',
      amountCents: 2000,
    });
    assert.strictEqual(actor.getSnapshot().value, 'pending_payment');

    // Exact amount match
    actor.send({
      type: 'SUBMIT_PAYMENT',
      idempotencyKey: 'idem_key_1',
      amountCents: 2660,
    });
    assert.strictEqual(actor.getSnapshot().value, 'payment_processing');

    // Gateway success
    actor.send({
      type: 'PAYMENT_SUCCESS',
      paymentId: 'pay_123',
    });
    assert.strictEqual(actor.getSnapshot().value, 'paid');
    assert.strictEqual(actor.getSnapshot().context.paymentId, 'pay_123');
  });

  test('Zero-Trust Projection: paid state dispatches fulfillment to terminal fulfilled', () => {
    const actor = createCheckoutActor('paid', {
      cartId: 'c1',
      totalCents: 2660,
    });

    // Invalid dispatch (empty carrier)
    actor.send({
      type: 'DISPATCH_FULFILLMENT',
      trackingNumber: 'TRK999',
      carrier: '',
    });
    assert.strictEqual(actor.getSnapshot().value, 'paid');

    // Valid dispatch
    actor.send({
      type: 'DISPATCH_FULFILLMENT',
      trackingNumber: 'TRK999',
      carrier: 'DHL',
    });
    assert.strictEqual(actor.getSnapshot().value, 'fulfilled');
    assert.strictEqual(actor.getSnapshot().context.trackingNumber, 'TRK999');
    assert.strictEqual(actor.getSnapshot().context.carrier, 'DHL');
  });
});
