import { test, describe } from 'node:test';
import assert from 'node:assert';
import { createActor } from 'xstate';
import { checkoutMachine } from '../src/machines/checkoutMachine';

describe('Checkout State Machine - Axiomatic Invariants', () => {
  test('Axiom 1: SUBMIT_PAYMENT is mathematically impossible in EMPTY_CART', () => {
    const actor = createActor(checkoutMachine).start();
    assert.strictEqual(actor.getSnapshot().value, 'empty_cart');

    // Attempt illegal transition
    actor.send({
      type: 'SUBMIT_PAYMENT',
      idempotencyKey: 'idem_illegal_123',
      amountCents: 1000,
    });

    // Verify state has not mutated
    assert.strictEqual(actor.getSnapshot().value, 'empty_cart');
    assert.strictEqual(actor.getSnapshot().context.items.length, 0);
  });

  test('Axiom 2: INITIATE_CHECKOUT is blocked on EMPTY_CART', () => {
    const actor = createActor(checkoutMachine).start();
    actor.send({ type: 'INITIATE_CHECKOUT' });
    assert.strictEqual(actor.getSnapshot().value, 'empty_cart');
  });

  test('Axiom 3: Complete legal sequence from Cart to Fulfilled', () => {
    const actor = createActor(checkoutMachine).start();
    assert.strictEqual(actor.getSnapshot().value, 'empty_cart');

    // 1. Add item -> cart_active
    actor.send({
      type: 'ADD_ITEM',
      item: {
        productId: 'prod_1',
        sku: 'SKU-SHIRT',
        title: 'Oxford Cotton Shirt',
        unitPriceCents: 4000,
        quantity: 2,
      },
    });
    assert.strictEqual(actor.getSnapshot().value, 'cart_active');
    const ctx1 = actor.getSnapshot().context;
    assert.strictEqual(ctx1.subtotalCents, 8000); // 4000 * 2
    assert.strictEqual(ctx1.taxCents, 640);       // 8% tax
    assert.strictEqual(ctx1.totalCents, 8640);

    // 2. Initiate Checkout -> checkout_draft
    actor.send({ type: 'INITIATE_CHECKOUT' });
    assert.strictEqual(actor.getSnapshot().value, 'checkout_draft');

    // 3. Attach invalid shipping -> stays in checkout_draft
    actor.send({
      type: 'ATTACH_SHIPPING',
      address: {
        recipientName: '',
        addressLine1: '',
        city: '',
        postalCode: '',
        country: '',
      },
    });
    assert.strictEqual(actor.getSnapshot().value, 'checkout_draft');

    // 4. Attach valid shipping -> pending_payment
    actor.send({
      type: 'ATTACH_SHIPPING',
      address: {
        recipientName: 'Jane Doe',
        addressLine1: '123 Market St',
        city: 'San Francisco',
        postalCode: '94105',
        country: 'USA',
      },
      shippingCents: 500,
    });
    assert.strictEqual(actor.getSnapshot().value, 'pending_payment');
    const ctx2 = actor.getSnapshot().context;
    assert.strictEqual(ctx2.shippingCents, 500);
    assert.strictEqual(ctx2.totalCents, 8000 + 500 + 640); // 9140 cents

    // 5. Submit payment with mismatched amount -> rejected, stays in pending_payment
    actor.send({
      type: 'SUBMIT_PAYMENT',
      idempotencyKey: 'idem_999',
      amountCents: 5000, // wrong amount!
    });
    assert.strictEqual(actor.getSnapshot().value, 'pending_payment');

    // 6. Submit payment with exact amount -> payment_processing
    actor.send({
      type: 'SUBMIT_PAYMENT',
      idempotencyKey: 'idem_valid_999',
      amountCents: 9140,
    });
    assert.strictEqual(actor.getSnapshot().value, 'payment_processing');

    // 7. Gateway responds with success -> paid
    actor.send({
      type: 'PAYMENT_SUCCESS',
      paymentId: 'pay_txn_777',
    });
    assert.strictEqual(actor.getSnapshot().value, 'paid');
    assert.strictEqual(actor.getSnapshot().context.paymentId, 'pay_txn_777');

    // 8. Dispatch warehouse fulfillment -> fulfilled
    actor.send({
      type: 'DISPATCH_FULFILLMENT',
      trackingNumber: '1Z9999999999999999',
      carrier: 'UPS',
    });
    assert.strictEqual(actor.getSnapshot().value, 'fulfilled');
    assert.strictEqual(actor.getSnapshot().context.trackingNumber, '1Z9999999999999999');
  });

  test('Axiom 4: Removing all items reverts cart_active to empty_cart', () => {
    const actor = createActor(checkoutMachine).start();
    actor.send({
      type: 'ADD_ITEM',
      item: {
        id: 'item_to_remove',
        productId: 'prod_2',
        sku: 'SKU-HAT',
        title: 'Beanie',
        unitPriceCents: 1500,
        quantity: 1,
      },
    });
    assert.strictEqual(actor.getSnapshot().value, 'cart_active');

    actor.send({ type: 'REMOVE_ITEM', itemId: 'item_to_remove' });
    assert.strictEqual(actor.getSnapshot().value, 'empty_cart');
    assert.strictEqual(actor.getSnapshot().context.items.length, 0);
  });

  test('Axiom 5: UPDATE_QUANTITY updates quantity and totals, or reverts to empty_cart when 0', () => {
    const actor = createActor(checkoutMachine).start();
    actor.send({
      type: 'ADD_ITEM',
      item: {
        id: 'item_qty_test',
        productId: 'prod_qty',
        sku: 'SKU-QTY',
        title: 'Quantity Test Item',
        unitPriceCents: 2000,
        quantity: 1,
      },
    });
    assert.strictEqual(actor.getSnapshot().value, 'cart_active');
    assert.strictEqual(actor.getSnapshot().context.subtotalCents, 2000);

    // Update to 3
    actor.send({ type: 'UPDATE_QUANTITY', itemId: 'item_qty_test', quantity: 3 });
    assert.strictEqual(actor.getSnapshot().context.items[0].quantity, 3);
    assert.strictEqual(actor.getSnapshot().context.subtotalCents, 6000);
    assert.strictEqual(actor.getSnapshot().value, 'cart_active');

    // Reduce to 0 -> reverts to empty_cart
    actor.send({ type: 'UPDATE_QUANTITY', itemId: 'item_qty_test', quantity: 0 });
    assert.strictEqual(actor.getSnapshot().value, 'empty_cart');
    assert.strictEqual(actor.getSnapshot().context.items.length, 0);
  });

  test('Axiom 6: CANCEL_CHECKOUT returns to cart_active from draft, pending_payment, and payment_failed', () => {
    const actor = createActor(checkoutMachine).start();
    actor.send({
      type: 'ADD_ITEM',
      item: {
        productId: 'prod_cancel',
        sku: 'SKU-CANCEL',
        title: 'Cancel Item',
        unitPriceCents: 1000,
        quantity: 1,
      },
    });
    actor.send({ type: 'INITIATE_CHECKOUT' });
    assert.strictEqual(actor.getSnapshot().value, 'checkout_draft');

    // Cancel from checkout_draft -> cart_active
    actor.send({ type: 'CANCEL_CHECKOUT' });
    assert.strictEqual(actor.getSnapshot().value, 'cart_active');

    // Re-enter checkout_draft and attach shipping -> pending_payment
    actor.send({ type: 'INITIATE_CHECKOUT' });
    actor.send({
      type: 'ATTACH_SHIPPING',
      address: {
        recipientName: 'Tester',
        addressLine1: '123 Test St',
        city: 'Testing',
        postalCode: '12345',
        country: 'US',
      },
    });
    assert.strictEqual(actor.getSnapshot().value, 'pending_payment');

    // Cancel from pending_payment -> cart_active
    actor.send({ type: 'CANCEL_CHECKOUT' });
    assert.strictEqual(actor.getSnapshot().value, 'cart_active');

    // Move to payment_failed
    actor.send({ type: 'INITIATE_CHECKOUT' });
    actor.send({
      type: 'ATTACH_SHIPPING',
      address: {
        recipientName: 'Tester',
        addressLine1: '123 Test St',
        city: 'Testing',
        postalCode: '12345',
        country: 'US',
      },
    });
    const total = actor.getSnapshot().context.totalCents;
    actor.send({ type: 'SUBMIT_PAYMENT', idempotencyKey: 'idem_f1', amountCents: total });
    actor.send({ type: 'PAYMENT_ERROR', errorMessage: 'Decline' });
    assert.strictEqual(actor.getSnapshot().value, 'payment_failed');

    // Cancel from payment_failed -> cart_active
    actor.send({ type: 'CANCEL_CHECKOUT' });
    assert.strictEqual(actor.getSnapshot().value, 'cart_active');
  });

  test('Axiom 7: Discount code application during checkout_draft recalculates total and is preserved into pending_payment', () => {
    const actor = createActor(checkoutMachine).start();

    // 1. Cannot apply discount in empty_cart
    actor.send({ type: 'APPLY_DISCOUNT', code: 'SAVE10', discountCents: 1000 });
    assert.strictEqual(actor.getSnapshot().value, 'empty_cart');
    assert.strictEqual(actor.getSnapshot().context.discountCents, 0);

    // 2. Add item -> cart_active
    actor.send({
      type: 'ADD_ITEM',
      item: {
        productId: 'prod_tee',
        sku: 'SKU-TEE',
        title: 'T-Shirt',
        unitPriceCents: 5000,
        quantity: 1,
      },
    });
    actor.send({ type: 'INITIATE_CHECKOUT' });
    assert.strictEqual(actor.getSnapshot().value, 'checkout_draft');

    const subtotal = 5000;
    const tax = 400; // 8% of 5000
    assert.strictEqual(actor.getSnapshot().context.subtotalCents, subtotal);
    assert.strictEqual(actor.getSnapshot().context.totalCents, subtotal + tax);

    // 3. Apply discount $10.00
    actor.send({ type: 'APPLY_DISCOUNT', code: 'SAVE10', discountCents: 1000 });
    assert.strictEqual(actor.getSnapshot().context.discountCode, 'SAVE10');
    assert.strictEqual(actor.getSnapshot().context.discountCents, 1000);
    // Total without shipping: subtotal (5000) - discount (1000) + tax (400) = 4400
    assert.strictEqual(actor.getSnapshot().context.totalCents, 4400);

    // 4. Remove discount
    actor.send({ type: 'REMOVE_DISCOUNT' });
    assert.strictEqual(actor.getSnapshot().context.discountCode, null);
    assert.strictEqual(actor.getSnapshot().context.discountCents, 0);
    assert.strictEqual(actor.getSnapshot().context.totalCents, subtotal + tax);

    // 5. Re-apply discount $20.00
    actor.send({ type: 'APPLY_DISCOUNT', code: 'SAVE20', discountCents: 2000 });
    assert.strictEqual(actor.getSnapshot().context.discountCents, 2000);
    assert.strictEqual(actor.getSnapshot().context.totalCents, 3400);

    // 6. Attach shipping (shipping = $5.00) -> pending_payment
    actor.send({
      type: 'ATTACH_SHIPPING',
      address: {
        recipientName: 'Alex Doe',
        addressLine1: '789 Market St',
        city: 'San Francisco',
        postalCode: '94103',
        country: 'USA',
      },
      shippingCents: 500,
    });

    assert.strictEqual(actor.getSnapshot().value, 'pending_payment');
    // Total with shipping: subtotal (5000) - discount (2000) + shipping (500) + tax (400) = 3900
    assert.strictEqual(actor.getSnapshot().context.totalCents, 3900);
    assert.strictEqual(actor.getSnapshot().context.discountCode, 'SAVE20');
  });
});
