/**
 * Checkout State Machine - Axioma Executable Architecture
 * Governs the temporal logic and legal state transitions for the Checkout Flow.
 * 
 * Formal Invariants:
 * 1. For state = empty_cart, SUBMIT_PAYMENT transition does NOT exist (mathematically impossible).
 * 2. Total cents is deterministic: total = subtotal + shipping + tax.
 * 3. Idempotent payment submission requires non-empty idempotencyKey and exact amount matching.
 */

import { setup, assign } from 'xstate';

export interface CartItem {
  id: string;
  productId: string;
  sku: string;
  title: string;
  unitPriceCents: number;
  quantity: number;
}

export interface ShippingAddress {
  recipientName: string;
  addressLine1: string;
  city: string;
  postalCode: string;
  country: string;
}

export interface CheckoutContext {
  cartId: string;
  items: CartItem[];
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  discountCode: string | null;
  discountCents: number;
  totalCents: number;
  shippingAddress: ShippingAddress | null;
  paymentId: string | null;
  idempotencyKey: string | null;
  paymentError: string | null;
  trackingNumber: string | null;
  carrier: string | null;
}

export type CheckoutEvent =
  | { type: 'ADD_ITEM'; item: Omit<CartItem, 'id'> & { id?: string } }
  | { type: 'REMOVE_ITEM'; itemId: string }
  | { type: 'UPDATE_QUANTITY'; itemId: string; quantity: number }
  | { type: 'INITIATE_CHECKOUT' }
  | { type: 'APPLY_DISCOUNT'; code: string; discountCents: number }
  | { type: 'REMOVE_DISCOUNT' }
  | { type: 'ATTACH_SHIPPING'; address: ShippingAddress; shippingCents?: number }
  | { type: 'CANCEL_CHECKOUT' }
  | { type: 'SUBMIT_PAYMENT'; idempotencyKey: string; amountCents: number }
  | { type: 'PAYMENT_SUCCESS'; paymentId: string }
  | { type: 'PAYMENT_ERROR'; errorMessage: string }
  | { type: 'RETRY_PAYMENT' }
  | { type: 'DISPATCH_FULFILLMENT'; trackingNumber: string; carrier: string };

function calculateSubtotal(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
}

function calculateTax(subtotalCents: number): number {
  // Simple 8% deterministic tax calculation
  return Math.round(subtotalCents * 0.08);
}

export const checkoutMachine = setup({
  types: {
    context: {} as CheckoutContext,
    events: {} as CheckoutEvent,
  },
  guards: {
    hasItems: ({ context }) => context.items.length > 0,
    hasNoItems: ({ context }) => context.items.length === 0,
    isValidShippingAddress: ({ event }) => {
      if (event.type !== 'ATTACH_SHIPPING') return false;
      const addr = event.address;
      return Boolean(
        addr.recipientName?.trim() &&
        addr.addressLine1?.trim() &&
        addr.city?.trim() &&
        addr.postalCode?.trim() &&
        addr.country?.trim()
      );
    },
    isValidPaymentSubmission: ({ context, event }) => {
      if (event.type !== 'SUBMIT_PAYMENT') return false;
      return (
        context.items.length > 0 &&
        Boolean(event.idempotencyKey?.trim()) &&
        event.amountCents === context.totalCents &&
        context.totalCents > 0
      );
    },
    hasValidTracking: ({ event }) => {
      if (event.type !== 'DISPATCH_FULFILLMENT') return false;
      return Boolean(event.trackingNumber?.trim() && event.carrier?.trim());
    },
  },
  actions: {
    addItemAction: assign(({ context, event }) => {
      if (event.type !== 'ADD_ITEM') return context;
      const existingIndex = context.items.findIndex(
        (i) => i.productId === event.item.productId
      );
      let updatedItems: CartItem[];
      if (existingIndex >= 0) {
        updatedItems = context.items.map((item, idx) =>
          idx === existingIndex
            ? { ...item, quantity: item.quantity + event.item.quantity }
            : item
        );
      } else {
        const newItem: CartItem = {
          id: event.item.id || `item_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          productId: event.item.productId,
          sku: event.item.sku,
          title: event.item.title,
          unitPriceCents: event.item.unitPriceCents,
          quantity: event.item.quantity,
        };
        updatedItems = [...context.items, newItem];
      }
      const subtotal = calculateSubtotal(updatedItems);
      const tax = calculateTax(subtotal);
      return {
        ...context,
        items: updatedItems,
        subtotalCents: subtotal,
        taxCents: tax,
        totalCents: subtotal + context.shippingCents + tax,
      };
    }),
    removeItemAction: assign(({ context, event }) => {
      if (event.type !== 'REMOVE_ITEM') return context;
      const updatedItems = context.items.filter((i) => i.id !== event.itemId);
      const subtotal = calculateSubtotal(updatedItems);
      const tax = calculateTax(subtotal);
      return {
        ...context,
        items: updatedItems,
        subtotalCents: subtotal,
        taxCents: tax,
        totalCents: subtotal + context.shippingCents + tax,
      };
    }),
    updateQuantityAction: assign(({ context, event }) => {
      if (event.type !== 'UPDATE_QUANTITY') return context;
      const updatedItems = context.items
        .map((item) =>
          item.id === event.itemId ? { ...item, quantity: event.quantity } : item
        )
        .filter((item) => item.quantity > 0);
      const subtotal = calculateSubtotal(updatedItems);
      const tax = calculateTax(subtotal);
      return {
        ...context,
        items: updatedItems,
        subtotalCents: subtotal,
        taxCents: tax,
        totalCents: subtotal + context.shippingCents + tax,
      };
    }),
    applyDiscountAction: assign(({ context, event }) => {
      if (event.type !== 'APPLY_DISCOUNT') return context;
      const discountCents = Math.min(event.discountCents, context.subtotalCents);
      const totalCents = Math.max(
        0,
        context.subtotalCents - discountCents + context.shippingCents + context.taxCents
      );
      return {
        ...context,
        discountCode: event.code,
        discountCents,
        totalCents,
      };
    }),
    removeDiscountAction: assign(({ context, event }) => {
      if (event.type !== 'REMOVE_DISCOUNT') return context;
      const totalCents = context.subtotalCents + context.shippingCents + context.taxCents;
      return {
        ...context,
        discountCode: null,
        discountCents: 0,
        totalCents,
      };
    }),
    attachShippingAction: assign(({ context, event }) => {
      if (event.type !== 'ATTACH_SHIPPING') return context;
      const shippingCents = event.shippingCents ?? 500; // Default $5.00 standard shipping
      const discountCents = context.discountCents ?? 0;
      const totalCents = Math.max(
        0,
        context.subtotalCents - discountCents + shippingCents + context.taxCents
      );
      return {
        ...context,
        shippingAddress: event.address,
        shippingCents,
        totalCents,
      };
    }),
    recordPaymentIntentAction: assign(({ context, event }) => {
      if (event.type !== 'SUBMIT_PAYMENT') return context;
      return {
        ...context,
        idempotencyKey: event.idempotencyKey,
        paymentError: null,
      };
    }),
    recordPaymentSuccessAction: assign(({ context, event }) => {
      if (event.type !== 'PAYMENT_SUCCESS') return context;
      return {
        ...context,
        paymentId: event.paymentId,
        paymentError: null,
      };
    }),
    recordPaymentErrorAction: assign(({ context, event }) => {
      if (event.type !== 'PAYMENT_ERROR') return context;
      return {
        ...context,
        paymentError: event.errorMessage,
      };
    }),
    recordFulfillmentAction: assign(({ context, event }) => {
      if (event.type !== 'DISPATCH_FULFILLMENT') return context;
      return {
        ...context,
        trackingNumber: event.trackingNumber,
        carrier: event.carrier,
      };
    }),
  },
}).createMachine({
  id: 'checkout',
  initial: 'empty_cart',
  context: {
    cartId: 'cart_default',
    items: [],
    subtotalCents: 0,
    shippingCents: 0,
    taxCents: 0,
    discountCode: null,
    discountCents: 0,
    totalCents: 0,
    shippingAddress: null,
    paymentId: null,
    idempotencyKey: null,
    paymentError: null,
    trackingNumber: null,
    carrier: null,
  },
  states: {
    /**
     * State 1: EMPTY_CART
     * Invariant: SUBMIT_PAYMENT is mathematically unhandled.
     * Transitions only on ADD_ITEM.
     */
    empty_cart: {
      on: {
        ADD_ITEM: {
          target: 'cart_active',
          actions: 'addItemAction',
        },
      },
    },

    /**
     * State 2: CART_ACTIVE
     * Invariant: Shopper can mutate items. Cannot submit payment.
     * Can initiate checkout only if hasItems.
     */
    cart_active: {
      on: {
        ADD_ITEM: {
          actions: 'addItemAction',
        },
        REMOVE_ITEM: [
          {
            target: 'empty_cart',
            guard: ({ context, event }) =>
              context.items.filter((i) => i.id !== event.itemId).length === 0,
            actions: 'removeItemAction',
          },
          {
            actions: 'removeItemAction',
          },
        ],
        UPDATE_QUANTITY: [
          {
            target: 'empty_cart',
            guard: ({ context, event }) =>
              context.items
                .map((i) => (i.id === event.itemId ? { ...i, quantity: event.quantity } : i))
                .filter((i) => i.quantity > 0).length === 0,
            actions: 'updateQuantityAction',
          },
          {
            actions: 'updateQuantityAction',
          },
        ],
        INITIATE_CHECKOUT: {
          target: 'checkout_draft',
          guard: 'hasItems',
        },
      },
    },

    /**
     * State 3: CHECKOUT_DRAFT
     * Invariant: Cart is locked. Awaits valid shipping information.
     */
    checkout_draft: {
      on: {
        APPLY_DISCOUNT: {
          actions: 'applyDiscountAction',
        },
        REMOVE_DISCOUNT: {
          actions: 'removeDiscountAction',
        },
        ATTACH_SHIPPING: {
          target: 'pending_payment',
          guard: 'isValidShippingAddress',
          actions: 'attachShippingAction',
        },
        CANCEL_CHECKOUT: {
          target: 'cart_active',
        },
      },
    },

    /**
     * State 4: PENDING_PAYMENT
     * Invariant: Total is frozen. SUBMIT_PAYMENT is legal ONLY here,
     * guarded by matching amount, idempotency key, and non-empty items.
     */
    pending_payment: {
      on: {
        SUBMIT_PAYMENT: {
          target: 'payment_processing',
          guard: 'isValidPaymentSubmission',
          actions: 'recordPaymentIntentAction',
        },
        CANCEL_CHECKOUT: {
          target: 'cart_active',
        },
      },
    },

    /**
     * State 5: PAYMENT_PROCESSING
     * Invariant: Gateway transaction in-flight.
     */
    payment_processing: {
      on: {
        PAYMENT_SUCCESS: {
          target: 'paid',
          actions: 'recordPaymentSuccessAction',
        },
        PAYMENT_ERROR: {
          target: 'payment_failed',
          actions: 'recordPaymentErrorAction',
        },
      },
    },

    /**
     * State 6: PAYMENT_FAILED
     * Allows retry or cancel back to active cart.
     */
    payment_failed: {
      on: {
        RETRY_PAYMENT: {
          target: 'pending_payment',
        },
        CANCEL_CHECKOUT: {
          target: 'cart_active',
        },
      },
    },

    /**
     * State 7: PAID
     * Invariant: Commercial contract settled. Irreversible.
     * Transitions only to fulfilled via warehouse carrier dispatch.
     */
    paid: {
      on: {
        DISPATCH_FULFILLMENT: {
          target: 'fulfilled',
          guard: 'hasValidTracking',
          actions: 'recordFulfillmentAction',
        },
      },
    },

    /**
     * State 8: FULFILLED (Terminal state)
     */
    fulfilled: {
      type: 'final',
    },
  },
});
