/**
 * Fulfillment State Machine - Axioma Executable Architecture
 * Governs the temporal logic and legal state transitions for the Fulfillment Domain.
 * 
 * Formal Invariants:
 * 1. States move forward: unfulfilled -> inventory_allocated -> label_printed -> in_transit.
 * 2. In unfulfilled state, only ALLOCATE_INVENTORY is legal. SUBMIT_PAYMENT is cross-domain and mathematically illegal.
 * 3. Printing shipping label requires inventory to be allocated and valid carrier.
 * 4. Dispatching shipment requires a valid tracking number and transitions to terminal in_transit.
 */

import { setup, assign, createActor } from 'xstate';

export interface FulfillmentItem {
  sku: string;
  quantity: number;
}

export interface FulfillmentContext {
  orderId: string;
  items: FulfillmentItem[];
  carrier: string | null;
  trackingNumber: string | null;
  shippingLabelUrl: string | null;
  allocatedAt: string | null;
  dispatchedAt: string | null;
}

export type FulfillmentEvent =
  | { type: 'ALLOCATE_INVENTORY'; orderId?: string; items?: FulfillmentItem[] }
  | { type: 'PRINT_LABEL'; carrier: string; shippingLabelUrl?: string }
  | { type: 'DISPATCH_SHIPMENT'; trackingNumber: string; carrier?: string }
  | { type: 'CANCEL_FULFILLMENT'; reason?: string };

export const fulfillmentMachine = setup({
  types: {
    context: {} as FulfillmentContext,
    events: {} as FulfillmentEvent,
  },
  guards: {
    hasValidItems: ({ context, event }) => {
      if (event.type !== 'ALLOCATE_INVENTORY') return false;
      const items = event.items || context.items;
      return Array.isArray(items) && items.length > 0;
    },
    hasValidCarrier: ({ event }) => {
      if (event.type !== 'PRINT_LABEL') return false;
      return Boolean(event.carrier?.trim());
    },
    hasValidTracking: ({ event }) => {
      if (event.type !== 'DISPATCH_SHIPMENT') return false;
      return Boolean(event.trackingNumber?.trim());
    },
  },
  actions: {
    allocateInventoryAction: assign(({ context, event }) => {
      if (event.type !== 'ALLOCATE_INVENTORY') return context;
      return {
        ...context,
        orderId: event.orderId || context.orderId,
        items: event.items || context.items,
        allocatedAt: new Date().toISOString(),
      };
    }),
    printLabelAction: assign(({ context, event }) => {
      if (event.type !== 'PRINT_LABEL') return context;
      return {
        ...context,
        carrier: event.carrier,
        shippingLabelUrl: event.shippingLabelUrl || `https://labels.axioma.local/${context.orderId || 'ord'}.pdf`,
      };
    }),
    dispatchShipmentAction: assign(({ context, event }) => {
      if (event.type !== 'DISPATCH_SHIPMENT') return context;
      return {
        ...context,
        trackingNumber: event.trackingNumber,
        carrier: event.carrier || context.carrier,
        dispatchedAt: new Date().toISOString(),
      };
    }),
  },
}).createMachine({
  id: 'fulfillment',
  initial: 'unfulfilled',
  context: {
    orderId: '',
    items: [],
    carrier: null,
    trackingNumber: null,
    shippingLabelUrl: null,
    allocatedAt: null,
    dispatchedAt: null,
  },
  states: {
    /**
     * State 1: UNFULFILLED
     * Invariant: Initial state. Awaits inventory allocation.
     * SUBMIT_PAYMENT is mathematically illegal and cross-domain.
     */
    unfulfilled: {
      on: {
        ALLOCATE_INVENTORY: {
          target: 'inventory_allocated',
          actions: 'allocateInventoryAction',
        },
      },
    },

    /**
     * State 2: INVENTORY_ALLOCATED
     * Invariant: Stock reserved. Awaits shipping label generation.
     */
    inventory_allocated: {
      on: {
        PRINT_LABEL: {
          target: 'label_printed',
          guard: 'hasValidCarrier',
          actions: 'printLabelAction',
        },
        CANCEL_FULFILLMENT: {
          target: 'unfulfilled',
        },
      },
    },

    /**
     * State 3: LABEL_PRINTED
     * Invariant: Package labeled and ready on loading dock.
     */
    label_printed: {
      on: {
        DISPATCH_SHIPMENT: {
          target: 'in_transit',
          guard: 'hasValidTracking',
          actions: 'dispatchShipmentAction',
        },
      },
    },

    /**
     * State 4: IN_TRANSIT (Terminal state)
     * Invariant: Package in custody of logistics carrier.
     */
    in_transit: {
      type: 'final',
    },
  },
});

export function createFulfillmentActor(
  initialState: 'unfulfilled' | 'inventory_allocated' | 'label_printed' | 'in_transit' = 'unfulfilled',
  contextSnapshot?: Partial<FulfillmentContext>
) {
  const blankActor = createActor(fulfillmentMachine);
  blankActor.start();
  const baseSnap = blankActor.getPersistedSnapshot() as any;
  blankActor.stop();

  const restoredActor = createActor(fulfillmentMachine, {
    snapshot: {
      ...baseSnap,
      value: initialState,
      context: {
        ...baseSnap.context,
        ...contextSnapshot,
      },
    } as any,
  });
  restoredActor.start();
  return restoredActor;
}
