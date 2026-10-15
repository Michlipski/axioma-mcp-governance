'use client';

import React, { useState } from 'react';
import Link from 'next/link';
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

  const [discountInput, setDiscountInput] = useState('SAVE10');

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
    <main
      style={{
        maxWidth: 920,
        margin: '0 auto',
        padding: '32px 24px',
        color: '#f4f4f5',
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <header
        style={{
          borderBottom: '1px solid #27272a',
          paddingBottom: 24,
          marginBottom: 28,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 16,
        }}
      >
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
          >
            &Delta;
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h1
                style={{
                  fontSize: '1.5rem',
                  fontWeight: 800,
                  margin: 0,
                  letterSpacing: '-0.02em',
                  color: '#fafafa',
                }}
              >
                Axioma: Executable Architecture Sandbox
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
              >
                Checkout Domain
              </span>
            </div>
            <p style={{ color: '#71717a', margin: '4px 0 0 0', fontSize: '0.85rem' }}>
              Declaratively bounded e-commerce checkout flow governed by XState v5 and GraphQL nouns.
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <a
            href="https://mlipski.ca"
            target="_blank"
            rel="noopener noreferrer"
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
          >
            Portfolio
          </a>
          <Link
            href="/showcase"
            style={{
              padding: '6px 12px',
              fontSize: '0.75rem',
              fontWeight: 600,
              background: '#047857',
              color: '#ecfdf5',
              borderRadius: 6,
              textDecoration: 'none',
              border: '1px solid #059669',
            }}
          >
            Showcase Flight Simulator &rarr;
          </Link>
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
          >
            Telemetry &rarr;
          </Link>
        </div>
      </header>

      {/* State Badge */}
      <section
        style={{
          background: '#18181b',
          border: '1px solid #27272a',
          padding: 20,
          borderRadius: 8,
          boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
          marginBottom: 24,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <span
              style={{
                fontSize: '0.75rem',
                textTransform: 'uppercase',
                color: '#71717a',
                letterSpacing: 1.2,
                fontWeight: 700,
              }}
            >
              Active State Boundary
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  backgroundColor: currentColor,
                  boxShadow: `0 0 8px ${currentColor}`,
                }}
              />
              <h2
                style={{
                  margin: 0,
                  color: currentColor,
                  fontSize: '1.5rem',
                  fontWeight: 800,
                  letterSpacing: '-0.02em',
                }}
              >
                {String(currentState).toUpperCase()}
              </h2>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span
              style={{
                fontSize: '0.75rem',
                textTransform: 'uppercase',
                color: '#71717a',
                letterSpacing: 1,
                fontWeight: 700,
              }}
            >
              Order Total
            </span>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#fafafa', marginTop: 2 }}>
              ${(context.totalCents / 100).toFixed(2)}
            </div>
          </div>
        </div>
      </section>

      {/* State Machine Step Controller */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {/* Left Column: Actions for Current State */}
        <section
          style={{
            background: '#18181b',
            border: '1px solid #27272a',
            padding: 20,
            borderRadius: 8,
            boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
          }}
        >
          <h3
            style={{
              marginTop: 0,
              fontSize: '1.1rem',
              fontWeight: 700,
              color: '#fafafa',
              borderBottom: '1px solid #27272a',
              paddingBottom: 12,
              marginBottom: 16,
            }}
          >
            Admissible State Transitions
          </h3>

          {currentState === 'empty_cart' && (
            <div>
              <p style={{ color: '#a1a1aa' }}>
                Your cart is empty. Axiom 1 enforces that SUBMIT_PAYMENT cannot fire.
              </p>
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
                style={{
                  padding: '10px 16px',
                  background: '#2563eb',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                + Add Item to Cart ($32.00)
              </button>
            </div>
          )}

          {currentState === 'cart_active' && (
            <div>
              <p style={{ color: '#a1a1aa' }}>
                Cart is ACTIVE. Items can be added, updated, removed, or checked out.
              </p>
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
                  style={{
                    padding: '8px 12px',
                    background: '#27272a',
                    border: '1px solid #3f3f46',
                    color: '#e4e4e7',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                    fontWeight: 500,
                  }}
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
                  style={{
                    padding: '8px 12px',
                    background: '#27272a',
                    border: '1px solid #3f3f46',
                    color: '#e4e4e7',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                    fontWeight: 500,
                  }}
                >
                  + Add Cap ($24.00)
                </button>
              </div>
              <button
                onClick={() => send({ type: 'INITIATE_CHECKOUT' })}
                style={{
                  width: '100%',
                  padding: '10px 16px',
                  background: '#7c3aed',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                Initiate Checkout &rarr;
              </button>
            </div>
          )}

          {currentState === 'checkout_draft' && (
            <div>
              <p style={{ color: '#a1a1aa' }}>
                Order draft initialized. Attach shipping address to proceed.
              </p>

              {/* Discount Code Application */}
              <div
                style={{
                  padding: 12,
                  background: '#121215',
                  border: '1px solid #27272a',
                  borderRadius: 6,
                  marginBottom: 16,
                }}
              >
                <label
                  style={{
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    color: '#d4d4d8',
                    display: 'block',
                    marginBottom: 4,
                  }}
                >
                  Promo / Discount Code
                </label>
                {context.discountCode ? (
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <span style={{ fontSize: '0.85rem', color: '#34d399', fontWeight: 700 }}>
                      Code Applied: {context.discountCode} (-${(context.discountCents / 100).toFixed(2)})
                    </span>
                    <button
                      onClick={() => send({ type: 'REMOVE_DISCOUNT' })}
                      style={{
                        padding: '4px 8px',
                        fontSize: '0.75rem',
                        background: '#3f1515',
                        color: '#fca5a5',
                        border: '1px solid #7f1d1d',
                        borderRadius: 4,
                        cursor: 'pointer',
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      type="text"
                      placeholder="e.g. SAVE10, SAVE20"
                      value={discountInput}
                      onChange={(e) => setDiscountInput(e.target.value)}
                      style={{
                        flex: 1,
                        padding: '6px 10px',
                        background: '#09090b',
                        border: '1px solid #3f3f46',
                        color: '#fafafa',
                        borderRadius: 4,
                        fontSize: '0.85rem',
                      }}
                    />
                    <button
                      onClick={() => {
                        const code = discountInput.trim().toUpperCase();
                        const amount =
                          code === 'SAVE20' || code === 'AXIOM20' || code === 'SUMMER20'
                            ? 2000
                            : 1000;
                        send({ type: 'APPLY_DISCOUNT', code, discountCents: amount });
                      }}
                      style={{
                        padding: '6px 12px',
                        background: '#2563eb',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 4,
                        cursor: 'pointer',
                        fontSize: '0.85rem',
                        fontWeight: 600,
                      }}
                    >
                      Apply
                    </button>
                  </div>
                )}
              </div>
              <div style={{ marginBottom: 16 }}>
                <label
                  style={{
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    color: '#d4d4d8',
                    display: 'block',
                    marginBottom: 4,
                  }}
                >
                  Recipient Name
                </label>
                <input
                  type="text"
                  value={shippingInput.recipientName}
                  onChange={(e) =>
                    setShippingInput({ ...shippingInput, recipientName: e.target.value })
                  }
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    background: '#09090b',
                    border: '1px solid #3f3f46',
                    color: '#fafafa',
                    borderRadius: 4,
                    marginBottom: 8,
                    boxSizing: 'border-box',
                  }}
                />
                <label
                  style={{
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    color: '#d4d4d8',
                    display: 'block',
                    marginBottom: 4,
                  }}
                >
                  Address Line 1
                </label>
                <input
                  type="text"
                  value={shippingInput.addressLine1}
                  onChange={(e) =>
                    setShippingInput({ ...shippingInput, addressLine1: e.target.value })
                  }
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    background: '#09090b',
                    border: '1px solid #3f3f46',
                    color: '#fafafa',
                    borderRadius: 4,
                    marginBottom: 8,
                    boxSizing: 'border-box',
                  }}
                />
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 8,
                    marginBottom: 8,
                  }}
                >
                  <div>
                    <label
                      style={{
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        color: '#d4d4d8',
                        display: 'block',
                        marginBottom: 4,
                      }}
                    >
                      City
                    </label>
                    <input
                      type="text"
                      value={shippingInput.city}
                      onChange={(e) =>
                        setShippingInput({ ...shippingInput, city: e.target.value })
                      }
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        background: '#09090b',
                        border: '1px solid #3f3f46',
                        color: '#fafafa',
                        borderRadius: 4,
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                  <div>
                    <label
                      style={{
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        color: '#d4d4d8',
                        display: 'block',
                        marginBottom: 4,
                      }}
                    >
                      Postal Code
                    </label>
                    <input
                      type="text"
                      value={shippingInput.postalCode}
                      onChange={(e) =>
                        setShippingInput({ ...shippingInput, postalCode: e.target.value })
                      }
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        background: '#09090b',
                        border: '1px solid #3f3f46',
                        color: '#fafafa',
                        borderRadius: 4,
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                </div>
                <label
                  style={{
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    color: '#d4d4d8',
                    display: 'block',
                    marginBottom: 4,
                  }}
                >
                  Country
                </label>
                <input
                  type="text"
                  value={shippingInput.country}
                  onChange={(e) =>
                    setShippingInput({ ...shippingInput, country: e.target.value })
                  }
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    background: '#09090b',
                    border: '1px solid #3f3f46',
                    color: '#fafafa',
                    borderRadius: 4,
                    boxSizing: 'border-box',
                  }}
                />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => send({ type: 'CANCEL_CHECKOUT' })}
                  style={{
                    flex: 1,
                    padding: '10px 14px',
                    background: '#27272a',
                    color: '#d4d4d8',
                    border: '1px solid #3f3f46',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  &larr; Back to Cart
                </button>
                <button
                  onClick={() =>
                    send({ type: 'ATTACH_SHIPPING', address: shippingInput, shippingCents: 500 })
                  }
                  style={{
                    flex: 2,
                    padding: '10px 16px',
                    background: '#d97706',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  Confirm Shipping &rarr;
                </button>
              </div>
            </div>
          )}

          {currentState === 'pending_payment' && (
            <div>
              <p style={{ color: '#a1a1aa' }}>
                Order ready for payment. Idempotent submission required.
              </p>
              <button
                onClick={() => {
                  send({
                    type: 'SUBMIT_PAYMENT',
                    idempotencyKey: `idem_${Date.now()}`,
                    amountCents: context.totalCents,
                  });
                }}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  background: '#059669',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontWeight: 700,
                  marginBottom: 8,
                }}
              >
                Submit Payment (${(context.totalCents / 100).toFixed(2)})
              </button>
              <button
                onClick={() => send({ type: 'CANCEL_CHECKOUT' })}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  background: '#27272a',
                  color: '#d4d4d8',
                  border: '1px solid #3f3f46',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                &larr; Cancel Checkout (Return to Cart)
              </button>
            </div>
          )}

          {currentState === 'payment_processing' && (
            <div>
              <p style={{ color: '#a1a1aa' }}>Simulating gateway settlement...</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() =>
                    send({ type: 'PAYMENT_SUCCESS', paymentId: `pay_${Date.now()}` })
                  }
                  style={{
                    flex: 1,
                    padding: '10px',
                    background: '#059669',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  Gateway Success
                </button>
                <button
                  onClick={() =>
                    send({
                      type: 'PAYMENT_ERROR',
                      errorMessage: 'Card declined by issuing bank',
                    })
                  }
                  style={{
                    flex: 1,
                    padding: '10px',
                    background: '#b91c1c',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  Gateway Decline
                </button>
              </div>
            </div>
          )}

          {currentState === 'payment_failed' && (
            <div>
              <div
                style={{
                  padding: 12,
                  background: '#3f1515',
                  border: '1px solid #7f1d1d',
                  color: '#fca5a5',
                  borderRadius: 6,
                  marginBottom: 12,
                }}
              >
                Payment Failed: {context.paymentError}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => send({ type: 'CANCEL_CHECKOUT' })}
                  style={{
                    flex: 1,
                    padding: '10px',
                    background: '#27272a',
                    color: '#d4d4d8',
                    border: '1px solid #3f3f46',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  &larr; Return to Cart
                </button>
                <button
                  onClick={() => send({ type: 'RETRY_PAYMENT' })}
                  style={{
                    flex: 1,
                    padding: '10px',
                    background: '#2563eb',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  Retry Payment
                </button>
              </div>
            </div>
          )}

          {currentState === 'paid' && (
            <div>
              <div
                style={{
                  padding: 12,
                  background: '#064e3b',
                  border: '1px solid #059669',
                  color: '#6ee7b7',
                  borderRadius: 6,
                  marginBottom: 12,
                }}
              >
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
                style={{
                  width: '100%',
                  padding: '10px',
                  background: '#047857',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                Dispatch Warehouse Fulfillment &rarr;
              </button>
            </div>
          )}

          {currentState === 'fulfilled' && (
            <div
              style={{
                padding: 16,
                background: '#064e3b',
                border: '1px solid #059669',
                color: '#6ee7b7',
                borderRadius: 6,
                textAlign: 'center',
              }}
            >
              <h4 style={{ margin: '0 0 8px 0', fontSize: '1.2rem', color: '#ecfdf5' }}>
                Order Fulfilled!
              </h4>
              <p style={{ margin: 0, color: '#a7f3d0' }}>Carrier: {context.carrier}</p>
              <p style={{ margin: '4px 0 16px 0', fontWeight: 700, color: '#ecfdf5' }}>
                Tracking: {context.trackingNumber}
              </p>
              <button
                onClick={onReset}
                style={{
                  padding: '10px 16px',
                  background: '#10b981',
                  color: '#064e3b',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontWeight: 700,
                }}
              >
                Continue Shopping (New Cart)
              </button>
            </div>
          )}
        </section>

        {/* Right Column: Context Snapshot */}
        <section
          style={{
            background: '#18181b',
            border: '1px solid #27272a',
            padding: 20,
            borderRadius: 8,
            boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
          }}
        >
          <h3
            style={{
              marginTop: 0,
              fontSize: '1.1rem',
              fontWeight: 700,
              color: '#fafafa',
              borderBottom: '1px solid #27272a',
              paddingBottom: 12,
              marginBottom: 16,
            }}
          >
            Current Context Snapshot
          </h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 16px 0' }}>
            {context.items.length === 0 ? (
              <li style={{ color: '#71717a', fontStyle: 'italic' }}>No items in cart</li>
            ) : (
              context.items.map((item) => (
                <li
                  key={item.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 0',
                    borderBottom: '1px solid #27272a',
                  }}
                >
                  <div style={{ flex: 1, paddingRight: 8 }}>
                    <div style={{ fontWeight: 600, color: '#fafafa' }}>{item.title}</div>
                    <div style={{ fontSize: '0.85rem', color: '#a1a1aa' }}>
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
                            border: '1px solid #3f3f46',
                            borderRadius: 4,
                            background: '#27272a',
                            color: '#e4e4e7',
                            cursor: 'pointer',
                            fontWeight: 700,
                            lineHeight: '22px',
                          }}
                        >
                          -
                        </button>
                        <span
                          style={{
                            fontSize: '0.9rem',
                            minWidth: 20,
                            textAlign: 'center',
                            color: '#fafafa',
                          }}
                        >
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
                            border: '1px solid #3f3f46',
                            borderRadius: 4,
                            background: '#27272a',
                            color: '#e4e4e7',
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
                            border: '1px solid #7f1d1d',
                            borderRadius: 4,
                            background: '#3f1515',
                            color: '#fca5a5',
                            cursor: 'pointer',
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    )}
                    <span
                      style={{
                        fontWeight: 600,
                        minWidth: 60,
                        textAlign: 'right',
                        color: '#fafafa',
                      }}
                    >
                      ${((item.unitPriceCents * item.quantity) / 100).toFixed(2)}
                    </span>
                  </div>
                </li>
              ))
            )}
          </ul>
          <div
            style={{
              fontSize: '0.85rem',
              color: '#a1a1aa',
              borderTop: '1px solid #27272a',
              paddingTop: 12,
            }}
          >
            <div>Subtotal: ${(context.subtotalCents / 100).toFixed(2)}</div>
            <div style={{ marginTop: 2 }}>Shipping: ${(context.shippingCents / 100).toFixed(2)}</div>
            <div style={{ marginTop: 2 }}>Tax (8%): ${(context.taxCents / 100).toFixed(2)}</div>
            {context.discountCents > 0 && (
              <div style={{ color: '#34d399', fontWeight: 600, marginTop: 2 }}>
                Discount ({context.discountCode}): -${(context.discountCents / 100).toFixed(2)}
              </div>
            )}
            <div
              style={{
                fontWeight: 700,
                color: '#fafafa',
                fontSize: '1rem',
                marginTop: 6,
                paddingTop: 6,
                borderTop: '1px dashed #27272a',
              }}
            >
              Total: ${(context.totalCents / 100).toFixed(2)}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
