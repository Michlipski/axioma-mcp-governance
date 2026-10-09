'use client';

import React, { useState } from 'react';
import { useMachine } from '@xstate/react';
import { checkoutMachine } from '../machines/checkoutMachine';

export default function CheckoutPage() {
  const [resetKey, setResetKey] = useState(0);

  return <CheckoutView key={resetKey} onReset={() => setResetKey((k) => k + 1)} />;
}

function CheckoutView({ onReset }: { onReset: () => void }) {
  const [snapshot, send] = useMachine(checkoutMachine);
  const { value: currentState, context } = snapshot;

  const [shippingInput, setShippingInput] = useState({
    recipientName: 'Jane Shopper',
    addressLine1: '456 Axiom Ave',
    city: 'San Francisco',
    postalCode: '94107',
    country: 'USA',
  });

  const stateColors: Record<string, string> = {
    empty_cart: '#94a3b8',
    cart_active: '#3b82f6',
    checkout_draft: '#8b5cf6',
    pending_payment: '#f59e0b',
    payment_processing: '#eab308',
    payment_failed: '#ef4444',
    paid: '#10b981',
    fulfilled: '#059669',
  };

  const currentColor = stateColors[String(currentState)] || '#64748b';

  return (
    <main style={{ maxWidth: 860, margin: '40px auto', padding: '0 20px', fontFamily: 'sans-serif' }}>
      <header style={{ borderBottom: '1px solid #e2e8f0', paddingBottom: 20, marginBottom: 24 }}>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 700, margin: '0 0 8px 0' }}>
          Axioma: Executable Architecture Sandbox
        </h1>
        <p style={{ color: '#64748b', margin: 0 }}>
          Declaratively bounded e-commerce checkout flow governed by XState v5 and GraphQL nouns.
        </p>
      </header>

      {/* State Badge */}
      <section style={{ background: '#ffffff', padding: 20, borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.1)', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <span style={{ fontSize: '0.85rem', textTransform: 'uppercase', color: '#64748b', letterSpacing: 1, fontWeight: 600 }}>
              Active State Boundary
            </span>
            <h2 style={{ margin: '4px 0 0 0', color: currentColor, fontSize: '1.5rem', fontWeight: 800 }}>
              {String(currentState).toUpperCase()}
            </h2>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span style={{ fontSize: '0.85rem', color: '#64748b' }}>Order Total</span>
            <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>
              ${(context.totalCents / 100).toFixed(2)}
            </div>
          </div>
        </div>
      </section>

      {/* State Machine Step Controller */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {/* Left Column: Actions for Current State */}
        <section style={{ background: '#ffffff', padding: 20, borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <h3 style={{ marginTop: 0, fontSize: '1.1rem', borderBottom: '1px solid #f1f5f9', paddingBottom: 8 }}>
            Admissible State Transitions
          </h3>

          {currentState === 'empty_cart' && (
            <div>
              <p style={{ color: '#64748b' }}>Your cart is empty. Axiom 1 enforces that SUBMIT_PAYMENT cannot fire.</p>
              <button
                onClick={() =>
                  send({
                    type: 'ADD_ITEM',
                    item: {
                      productId: 'prod_tee',
                      sku: 'SKU-AXIOM-TEE',
                      title: 'Axioma Architecture T-Shirt',
                      unitPriceCents: 3200,
                      quantity: 1,
                    },
                  })
                }
                style={{ padding: '10px 16px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
              >
                + Add Item to Cart ($32.00)
              </button>
            </div>
          )}

          {currentState === 'cart_active' && (
            <div>
              <p style={{ color: '#64748b' }}>Cart is ACTIVE. Items can be added, updated, removed, or checked out.</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                <button
                  onClick={() =>
                    send({
                      type: 'ADD_ITEM',
                      item: {
                        productId: `prod_sticker_${Date.now()}`,
                        sku: 'SKU-STICKER',
                        title: 'Axiom Holographic Sticker',
                        unitPriceCents: 600,
                        quantity: 1,
                      },
                    })
                  }
                  style={{ padding: '8px 12px', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 6, cursor: 'pointer', fontSize: '0.9rem' }}
                >
                  + Add Sticker ($6.00)
                </button>
                <button
                  onClick={() =>
                    send({
                      type: 'ADD_ITEM',
                      item: {
                        productId: `prod_cap_${Date.now()}`,
                        sku: 'SKU-CAP',
                        title: 'Axiom Baseball Cap',
                        unitPriceCents: 2400,
                        quantity: 1,
                      },
                    })
                  }
                  style={{ padding: '8px 12px', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 6, cursor: 'pointer', fontSize: '0.9rem' }}
                >
                  + Add Cap ($24.00)
                </button>
              </div>
              <button
                onClick={() => send({ type: 'INITIATE_CHECKOUT' })}
                style={{ width: '100%', padding: '10px 16px', background: '#8b5cf6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
              >
                Initiate Checkout &rarr;
              </button>
            </div>
          )}

          {currentState === 'checkout_draft' && (
            <div>
              <p style={{ color: '#64748b' }}>Order draft initialized. Attach shipping address to proceed.</p>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: '0.85rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>Recipient Name</label>
                <input
                  type="text"
                  value={shippingInput.recipientName}
                  onChange={(e) => setShippingInput({ ...shippingInput, recipientName: e.target.value })}
                  style={{ width: '100%', padding: '8px', border: '1px solid #cbd5e1', borderRadius: 4, marginBottom: 8, boxSizing: 'border-box' }}
                />
                <label style={{ fontSize: '0.85rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>Address Line 1</label>
                <input
                  type="text"
                  value={shippingInput.addressLine1}
                  onChange={(e) => setShippingInput({ ...shippingInput, addressLine1: e.target.value })}
                  style={{ width: '100%', padding: '8px', border: '1px solid #cbd5e1', borderRadius: 4, marginBottom: 8, boxSizing: 'border-box' }}
                />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                  <div>
                    <label style={{ fontSize: '0.85rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>City</label>
                    <input
                      type="text"
                      value={shippingInput.city}
                      onChange={(e) => setShippingInput({ ...shippingInput, city: e.target.value })}
                      style={{ width: '100%', padding: '8px', border: '1px solid #cbd5e1', borderRadius: 4, boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.85rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>Postal Code</label>
                    <input
                      type="text"
                      value={shippingInput.postalCode}
                      onChange={(e) => setShippingInput({ ...shippingInput, postalCode: e.target.value })}
                      style={{ width: '100%', padding: '8px', border: '1px solid #cbd5e1', borderRadius: 4, boxSizing: 'border-box' }}
                    />
                  </div>
                </div>
                <label style={{ fontSize: '0.85rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>Country</label>
                <input
                  type="text"
                  value={shippingInput.country}
                  onChange={(e) => setShippingInput({ ...shippingInput, country: e.target.value })}
                  style={{ width: '100%', padding: '8px', border: '1px solid #cbd5e1', borderRadius: 4, boxSizing: 'border-box' }}
                />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => send({ type: 'CANCEL_CHECKOUT' })}
                  style={{ flex: 1, padding: '10px 14px', background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
                >
                  &larr; Back to Cart
                </button>
                <button
                  onClick={() => send({ type: 'ATTACH_SHIPPING', address: shippingInput, shippingCents: 500 })}
                  style={{ flex: 2, padding: '10px 16px', background: '#f59e0b', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
                >
                  Confirm Shipping &rarr;
                </button>
              </div>
            </div>
          )}

          {currentState === 'pending_payment' && (
            <div>
              <p style={{ color: '#64748b' }}>Order ready for payment. Idempotent submission required.</p>
              <button
                onClick={() => {
                  send({
                    type: 'SUBMIT_PAYMENT',
                    idempotencyKey: `idem_${Date.now()}`,
                    amountCents: context.totalCents,
                  });
                }}
                style={{ width: '100%', padding: '12px 16px', background: '#10b981', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700, marginBottom: 8 }}
              >
                Submit Payment (${(context.totalCents / 100).toFixed(2)})
              </button>
              <button
                onClick={() => send({ type: 'CANCEL_CHECKOUT' })}
                style={{ width: '100%', padding: '10px 14px', background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
              >
                &larr; Cancel Checkout (Return to Cart)
              </button>
            </div>
          )}

          {currentState === 'payment_processing' && (
            <div>
              <p style={{ color: '#64748b' }}>Simulating gateway settlement...</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => send({ type: 'PAYMENT_SUCCESS', paymentId: `pay_${Date.now()}` })}
                  style={{ flex: 1, padding: '10px', background: '#10b981', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
                >
                  Gateway Success
                </button>
                <button
                  onClick={() => send({ type: 'PAYMENT_ERROR', errorMessage: 'Card declined by issuing bank' })}
                  style={{ flex: 1, padding: '10px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
                >
                  Gateway Decline
                </button>
              </div>
            </div>
          )}

          {currentState === 'payment_failed' && (
            <div>
              <div style={{ padding: 12, background: '#fee2e2', color: '#991b1b', borderRadius: 6, marginBottom: 12 }}>
                Payment Failed: {context.paymentError}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => send({ type: 'CANCEL_CHECKOUT' })}
                  style={{ flex: 1, padding: '10px', background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
                >
                  &larr; Return to Cart
                </button>
                <button
                  onClick={() => send({ type: 'RETRY_PAYMENT' })}
                  style={{ flex: 1, padding: '10px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
                >
                  Retry Payment
                </button>
              </div>
            </div>
          )}

          {currentState === 'paid' && (
            <div>
              <div style={{ padding: 12, background: '#dcfce7', color: '#166534', borderRadius: 6, marginBottom: 12 }}>
                Payment verified! Payment ID: {context.paymentId}
              </div>
              <button
                onClick={() =>
                  send({
                    type: 'DISPATCH_FULFILLMENT',
                    trackingNumber: `TRACK_${Date.now()}`,
                    carrier: 'FedEx Express',
                  })
                }
                style={{ width: '100%', padding: '10px', background: '#059669', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
              >
                Dispatch Warehouse Fulfillment &rarr;
              </button>
            </div>
          )}

          {currentState === 'fulfilled' && (
            <div style={{ padding: 16, background: '#ecfdf5', color: '#065f46', borderRadius: 6, textAlign: 'center' }}>
              <h4 style={{ margin: '0 0 8px 0', fontSize: '1.2rem' }}>Order Fulfilled!</h4>
              <p style={{ margin: 0 }}>Carrier: {context.carrier}</p>
              <p style={{ margin: '4px 0 16px 0', fontWeight: 700 }}>Tracking: {context.trackingNumber}</p>
              <button
                onClick={onReset}
                style={{ padding: '10px 16px', background: '#059669', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}
              >
                Continue Shopping (New Cart)
              </button>
            </div>
          )}
        </section>

        {/* Right Column: Context Snapshot */}
        <section style={{ background: '#ffffff', padding: 20, borderRadius: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          <h3 style={{ marginTop: 0, fontSize: '1.1rem', borderBottom: '1px solid #f1f5f9', paddingBottom: 8 }}>
            Current Context Snapshot
          </h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 16px 0' }}>
            {context.items.length === 0 ? (
              <li style={{ color: '#94a3b8', fontStyle: 'italic' }}>No items in cart</li>
            ) : (
              context.items.map((item) => (
                <li
                  key={item.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 0',
                    borderBottom: '1px solid #f8fafc',
                  }}
                >
                  <div style={{ flex: 1, paddingRight: 8 }}>
                    <div style={{ fontWeight: 600, color: '#1e293b' }}>{item.title}</div>
                    <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
                      ${(item.unitPriceCents / 100).toFixed(2)} each &times; {item.quantity}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {currentState === 'cart_active' && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <button
                          onClick={() =>
                            send({
                              type: 'UPDATE_QUANTITY',
                              itemId: item.id,
                              quantity: item.quantity - 1,
                            })
                          }
                          title="Decrease quantity"
                          style={{
                            width: 24,
                            height: 24,
                            padding: 0,
                            border: '1px solid #cbd5e1',
                            borderRadius: 4,
                            background: '#f8fafc',
                            cursor: 'pointer',
                            fontWeight: 700,
                            lineHeight: '22px',
                          }}
                        >
                          -
                        </button>
                        <span style={{ fontSize: '0.9rem', minWidth: 20, textAlign: 'center' }}>
                          {item.quantity}
                        </span>
                        <button
                          onClick={() =>
                            send({
                              type: 'UPDATE_QUANTITY',
                              itemId: item.id,
                              quantity: item.quantity + 1,
                            })
                          }
                          title="Increase quantity"
                          style={{
                            width: 24,
                            height: 24,
                            padding: 0,
                            border: '1px solid #cbd5e1',
                            borderRadius: 4,
                            background: '#f8fafc',
                            cursor: 'pointer',
                            fontWeight: 700,
                            lineHeight: '22px',
                          }}
                        >
                          +
                        </button>
                        <button
                          onClick={() => send({ type: 'REMOVE_ITEM', itemId: item.id })}
                          title="Remove item"
                          style={{
                            marginLeft: 4,
                            padding: '3px 8px',
                            fontSize: '0.75rem',
                            border: '1px solid #fca5a5',
                            borderRadius: 4,
                            background: '#fef2f2',
                            color: '#b91c1c',
                            cursor: 'pointer',
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    )}
                    <span style={{ fontWeight: 600, minWidth: 60, textAlign: 'right' }}>
                      ${((item.unitPriceCents * item.quantity) / 100).toFixed(2)}
                    </span>
                  </div>
                </li>
              ))
            )}
          </ul>
          <div style={{ fontSize: '0.85rem', color: '#64748b', borderTop: '1px solid #e2e8f0', paddingTop: 8 }}>
            <div>Subtotal: ${(context.subtotalCents / 100).toFixed(2)}</div>
            <div>Shipping: ${(context.shippingCents / 100).toFixed(2)}</div>
            <div>Tax (8%): ${(context.taxCents / 100).toFixed(2)}</div>
            <div style={{ fontWeight: 700, color: '#0f172a', marginTop: 4 }}>
              Total: ${(context.totalCents / 100).toFixed(2)}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
