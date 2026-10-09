import { createActor } from 'xstate';
import {
  checkoutMachine,
  CheckoutContext,
  CartItem as MachineCartItem,
  ShippingAddress as MachineShippingAddress,
} from '../machines/checkoutMachine';
import { db, schema } from '../db';
import { eq, and } from 'drizzle-orm';
import { GraphQLScalarType, Kind } from 'graphql';
import crypto from 'node:crypto';

export const DateTimeScalar = new GraphQLScalarType({
  name: 'DateTime',
  description: 'DateTime custom scalar type adhering to ISO 8601',
  serialize(value: unknown): string | null {
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (typeof value === 'string' || typeof value === 'number') {
      return new Date(value).toISOString();
    }
    return null;
  },
  parseValue(value: unknown): Date | null {
    if (typeof value === 'string' || typeof value === 'number') {
      return new Date(value);
    }
    return null;
  },
  parseLiteral(ast): Date | null {
    if (ast.kind === Kind.STRING || ast.kind === Kind.INT) {
      return new Date(ast.value);
    }
    return null;
  },
});

/**
 * Reconstructs an XState actor restored to a specific state and context.
 * Used to enforce that all mutations run through the state machine's guards and transitions.
 */
export function createCheckoutActor(
  stateValue: string,
  context: Partial<CheckoutContext> = {}
) {
  const blankActor = createActor(checkoutMachine);
  blankActor.start();
  const baseSnap = blankActor.getPersistedSnapshot() as any;
  blankActor.stop();

  const restoredActor = createActor(checkoutMachine, {
    snapshot: {
      ...baseSnap,
      value: stateValue,
      context: {
        ...baseSnap.context,
        ...context,
      },
    } as any,
  });
  restoredActor.start();
  return restoredActor;
}

interface AddItemInput {
  productId: string;
  sku: string;
  title: string;
  unitPriceCents: number;
  quantity: number;
}

interface ShippingAddressInput {
  recipientName: string;
  addressLine1: string;
  city: string;
  postalCode: string;
  country: string;
}

interface PaymentInput {
  idempotencyKey: string;
  paymentToken: string;
  amountCents: number;
  currency?: string | null;
}

async function getCartWithItems(cartId: string) {
  const cart = await db.query.carts.findFirst({
    where: eq(schema.carts.id, cartId),
  });
  if (!cart) return null;

  const items = await db.query.cartItems.findMany({
    where: eq(schema.cartItems.cartId, cartId),
  });

  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const subtotalCents = items.reduce(
    (sum, item) => sum + item.unitPriceCents * item.quantity,
    0
  );

  return {
    ...cart,
    items,
    itemCount,
    subtotalCents,
  };
}

async function getOrderWithRelations(orderId: string) {
  const order = await db.query.orders.findFirst({
    where: eq(schema.orders.id, orderId),
  });
  if (!order) return null;

  const lineItems = await db.query.orderLineItems.findMany({
    where: eq(schema.orderLineItems.orderId, orderId),
  });

  const shippingAddress = await db.query.shippingAddresses.findFirst({
    where: eq(schema.shippingAddresses.orderId, orderId),
  });

  return {
    ...order,
    lineItems,
    shippingAddress: shippingAddress || null,
  };
}

export const resolvers = {
  DateTime: DateTimeScalar,

  CartItem: {
    totalCents(item: { unitPriceCents: number; quantity: number; totalCents?: number }) {
      return item.totalCents ?? item.unitPriceCents * item.quantity;
    },
  },

  Cart: {
    async items(parent: { id: string; items?: unknown[] }) {
      if (parent.items) return parent.items;
      return db.query.cartItems.findMany({
        where: eq(schema.cartItems.cartId, parent.id),
      });
    },
    async itemCount(parent: { id: string; itemCount?: number; items?: { quantity: number }[] }) {
      if (typeof parent.itemCount === 'number') return parent.itemCount;
      const items = parent.items || (await db.query.cartItems.findMany({
        where: eq(schema.cartItems.cartId, parent.id),
      }));
      return items.reduce((sum, i) => sum + i.quantity, 0);
    },
    async subtotalCents(parent: { id: string; subtotalCents?: number; items?: { unitPriceCents: number; quantity: number }[] }) {
      if (typeof parent.subtotalCents === 'number') return parent.subtotalCents;
      const items = parent.items || (await db.query.cartItems.findMany({
        where: eq(schema.cartItems.cartId, parent.id),
      }));
      return items.reduce((sum, i) => sum + i.unitPriceCents * i.quantity, 0);
    },
  },

  Order: {
    async lineItems(parent: { id: string; lineItems?: unknown[] }) {
      if (parent.lineItems) return parent.lineItems;
      return db.query.orderLineItems.findMany({
        where: eq(schema.orderLineItems.orderId, parent.id),
      });
    },
    async shippingAddress(parent: { id: string; shippingAddress?: unknown }) {
      if (parent.shippingAddress !== undefined) return parent.shippingAddress;
      const address = await db.query.shippingAddresses.findFirst({
        where: eq(schema.shippingAddresses.orderId, parent.id),
      });
      return address || null;
    },
  },

  PaymentResult: {
    transaction(parent: { transaction: unknown }) {
      return parent.transaction;
    },
    order(parent: { order: unknown }) {
      return parent.order;
    },
  },

  Query: {
    cart: async (_: unknown, { id }: { id: string }) => {
      return getCartWithItems(id);
    },

    order: async (_: unknown, { id }: { id: string }) => {
      return getOrderWithRelations(id);
    },

    paymentTransaction: async (_: unknown, { id }: { id: string }) => {
      const transaction = await db.query.paymentTransactions.findFirst({
        where: eq(schema.paymentTransactions.id, id),
      });
      return transaction || null;
    },

    fulfillmentJob: async (_: unknown, { orderId }: { orderId: string }) => {
      const job = await db.query.fulfillmentJobs.findFirst({
        where: eq(schema.fulfillmentJobs.orderId, orderId),
      });
      return job || null;
    },
  },

  Mutation: {
    createCart: async (_: unknown, { customerId }: { customerId?: string | null }) => {
      const cartId = crypto.randomUUID();

      // Zero-trust verification: machine begins in empty_cart
      const actor = createCheckoutActor('empty_cart', {
        cartId,
        items: [],
      });
      const initialSnapshot = actor.getSnapshot();
      if (initialSnapshot.value !== 'empty_cart') {
        throw new Error('Failed to initialize cart state machine');
      }

      // Project initial empty cart to database
      const [newCart] = await db
        .insert(schema.carts)
        .values({
          id: cartId,
          customerId: customerId || null,
          status: 'ACTIVE',
        })
        .returning();

      return {
        ...newCart,
        items: [],
        itemCount: 0,
        subtotalCents: 0,
      };
    },

    addItemToCart: async (
      _: unknown,
      { cartId, input }: { cartId: string; input: AddItemInput }
    ) => {
      if (input.quantity <= 0) {
        throw new Error('Item quantity must be greater than 0');
      }
      if (input.unitPriceCents < 0) {
        throw new Error('Item unitPriceCents must be non-negative');
      }

      const cart = await db.query.carts.findFirst({
        where: eq(schema.carts.id, cartId),
      });
      if (!cart) {
        throw new Error(`Cart not found: ${cartId}`);
      }
      if (cart.status !== 'ACTIVE') {
        throw new Error(`Cart ${cartId} is not ACTIVE (current status: ${cart.status})`);
      }

      const existingDbItems = await db.query.cartItems.findMany({
        where: eq(schema.cartItems.cartId, cartId),
      });

      const machineItems: MachineCartItem[] = existingDbItems.map((item) => ({
        id: item.id,
        productId: item.productId,
        sku: item.sku,
        title: item.title,
        unitPriceCents: item.unitPriceCents,
        quantity: item.quantity,
      }));

      const currentState = machineItems.length === 0 ? 'empty_cart' : 'cart_active';
      const actor = createCheckoutActor(currentState, {
        cartId,
        items: machineItems,
        subtotalCents: machineItems.reduce(
          (sum, i) => sum + i.unitPriceCents * i.quantity,
          0
        ),
      });

      const generatedItemId = crypto.randomUUID();

      // Zero-trust: Dispatch event to XState machine
      actor.send({
        type: 'ADD_ITEM',
        item: {
          id: generatedItemId,
          productId: input.productId,
          sku: input.sku,
          title: input.title,
          unitPriceCents: input.unitPriceCents,
          quantity: input.quantity,
        },
      });

      const nextSnapshot = actor.getSnapshot();
      if (nextSnapshot.value !== 'cart_active') {
        throw new Error('State machine rejected ADD_ITEM transition');
      }

      // Project machine transition to DB
      const existingDbItem = existingDbItems.find(
        (i) => i.productId === input.productId
      );

      if (existingDbItem) {
        const updatedMachineItem = nextSnapshot.context.items.find(
          (i) => i.productId === input.productId
        );
        if (!updatedMachineItem) {
          throw new Error('Item missing in machine context after ADD_ITEM');
        }
        await db
          .update(schema.cartItems)
          .set({ quantity: updatedMachineItem.quantity })
          .where(eq(schema.cartItems.id, existingDbItem.id));
      } else {
        await db.insert(schema.cartItems).values({
          id: generatedItemId,
          cartId,
          productId: input.productId,
          sku: input.sku,
          title: input.title,
          unitPriceCents: input.unitPriceCents,
          quantity: input.quantity,
        });
      }

      await db
        .update(schema.carts)
        .set({ updatedAt: new Date() })
        .where(eq(schema.carts.id, cartId));

      return getCartWithItems(cartId);
    },

    removeItemFromCart: async (
      _: unknown,
      { cartId, cartItemId }: { cartId: string; cartItemId: string }
    ) => {
      const cart = await db.query.carts.findFirst({
        where: eq(schema.carts.id, cartId),
      });
      if (!cart) {
        throw new Error(`Cart not found: ${cartId}`);
      }
      if (cart.status !== 'ACTIVE') {
        throw new Error(`Cart ${cartId} is not ACTIVE (current status: ${cart.status})`);
      }

      const existingDbItems = await db.query.cartItems.findMany({
        where: eq(schema.cartItems.cartId, cartId),
      });

      const targetItem = existingDbItems.find((i) => i.id === cartItemId);
      if (!targetItem) {
        throw new Error(`Cart item not found: ${cartItemId}`);
      }

      const machineItems: MachineCartItem[] = existingDbItems.map((item) => ({
        id: item.id,
        productId: item.productId,
        sku: item.sku,
        title: item.title,
        unitPriceCents: item.unitPriceCents,
        quantity: item.quantity,
      }));

      const actor = createCheckoutActor('cart_active', {
        cartId,
        items: machineItems,
        subtotalCents: machineItems.reduce(
          (sum, i) => sum + i.unitPriceCents * i.quantity,
          0
        ),
      });

      // Zero-trust: Dispatch REMOVE_ITEM to state machine
      actor.send({
        type: 'REMOVE_ITEM',
        itemId: cartItemId,
      });

      const nextSnapshot = actor.getSnapshot();
      if (
        nextSnapshot.value !== 'cart_active' &&
        nextSnapshot.value !== 'empty_cart'
      ) {
        throw new Error('State machine rejected REMOVE_ITEM transition');
      }

      // Project removal to database
      await db
        .delete(schema.cartItems)
        .where(
          and(
            eq(schema.cartItems.id, cartItemId),
            eq(schema.cartItems.cartId, cartId)
          )
        );

      await db
        .update(schema.carts)
        .set({ updatedAt: new Date() })
        .where(eq(schema.carts.id, cartId));

      return getCartWithItems(cartId);
    },

    updateCartItemQuantity: async (
      _: unknown,
      {
        cartId,
        cartItemId,
        quantity,
      }: { cartId: string; cartItemId: string; quantity: number }
    ) => {
      if (quantity < 0) {
        throw new Error('Quantity must be greater than or equal to 0');
      }

      const cart = await db.query.carts.findFirst({
        where: eq(schema.carts.id, cartId),
      });
      if (!cart) {
        throw new Error(`Cart not found: ${cartId}`);
      }
      if (cart.status !== 'ACTIVE') {
        throw new Error(`Cart ${cartId} is not ACTIVE (current status: ${cart.status})`);
      }

      const existingDbItems = await db.query.cartItems.findMany({
        where: eq(schema.cartItems.cartId, cartId),
      });

      const targetItem = existingDbItems.find((i) => i.id === cartItemId);
      if (!targetItem) {
        throw new Error(`Cart item not found: ${cartItemId}`);
      }

      const machineItems: MachineCartItem[] = existingDbItems.map((item) => ({
        id: item.id,
        productId: item.productId,
        sku: item.sku,
        title: item.title,
        unitPriceCents: item.unitPriceCents,
        quantity: item.quantity,
      }));

      const actor = createCheckoutActor('cart_active', {
        cartId,
        items: machineItems,
        subtotalCents: machineItems.reduce(
          (sum, i) => sum + i.unitPriceCents * i.quantity,
          0
        ),
      });

      // Zero-trust: Dispatch UPDATE_QUANTITY to state machine
      actor.send({
        type: 'UPDATE_QUANTITY',
        itemId: cartItemId,
        quantity,
      });

      const nextSnapshot = actor.getSnapshot();
      if (
        nextSnapshot.value !== 'cart_active' &&
        nextSnapshot.value !== 'empty_cart'
      ) {
        throw new Error('State machine rejected UPDATE_QUANTITY transition');
      }

      // Project to DB based on resulting machine state
      if (quantity === 0) {
        await db
          .delete(schema.cartItems)
          .where(
            and(
              eq(schema.cartItems.id, cartItemId),
              eq(schema.cartItems.cartId, cartId)
            )
          );
      } else {
        await db
          .update(schema.cartItems)
          .set({ quantity })
          .where(
            and(
              eq(schema.cartItems.id, cartItemId),
              eq(schema.cartItems.cartId, cartId)
            )
          );
      }

      await db
        .update(schema.carts)
        .set({ updatedAt: new Date() })
        .where(eq(schema.carts.id, cartId));

      return getCartWithItems(cartId);
    },

    initiateCheckout: async (_: unknown, { cartId }: { cartId: string }) => {
      const cart = await db.query.carts.findFirst({
        where: eq(schema.carts.id, cartId),
      });
      if (!cart) {
        throw new Error(`Cart not found: ${cartId}`);
      }
      if (cart.status !== 'ACTIVE') {
        throw new Error(`Cart ${cartId} is not ACTIVE (current status: ${cart.status})`);
      }

      const existingDbItems = await db.query.cartItems.findMany({
        where: eq(schema.cartItems.cartId, cartId),
      });
      if (existingDbItems.length === 0) {
        throw new Error('Cannot initiate checkout on an empty cart');
      }

      const machineItems: MachineCartItem[] = existingDbItems.map((item) => ({
        id: item.id,
        productId: item.productId,
        sku: item.sku,
        title: item.title,
        unitPriceCents: item.unitPriceCents,
        quantity: item.quantity,
      }));

      const subtotalCents = machineItems.reduce(
        (sum, i) => sum + i.unitPriceCents * i.quantity,
        0
      );
      const taxCents = Math.round(subtotalCents * 0.08);

      const actor = createCheckoutActor('cart_active', {
        cartId,
        items: machineItems,
        subtotalCents,
        taxCents,
        totalCents: subtotalCents + taxCents,
      });

      // Zero-trust: Dispatch INITIATE_CHECKOUT to state machine
      actor.send({ type: 'INITIATE_CHECKOUT' });

      const nextSnapshot = actor.getSnapshot();
      if (nextSnapshot.value !== 'checkout_draft') {
        throw new Error('State machine rejected INITIATE_CHECKOUT transition');
      }

      // Project valid transition to DB: Lock cart
      await db
        .update(schema.carts)
        .set({
          status: 'LOCKED_FOR_CHECKOUT',
          updatedAt: new Date(),
        })
        .where(eq(schema.carts.id, cartId));

      // Project draft order creation
      const orderId = crypto.randomUUID();
      const orderNumber = `ORD-${Date.now()}-${Math.random()
        .toString(36)
        .substring(2, 7)
        .toUpperCase()}`;

      const [newOrder] = await db
        .insert(schema.orders)
        .values({
          id: orderId,
          orderNumber,
          customerId: cart.customerId,
          cartId: cart.id,
          status: 'DRAFT',
          subtotalCents: nextSnapshot.context.subtotalCents,
          shippingCents: nextSnapshot.context.shippingCents,
          taxCents: nextSnapshot.context.taxCents,
          totalCents: nextSnapshot.context.totalCents,
        })
        .returning();

      // Project line items snapshot
      for (const item of existingDbItems) {
        await db.insert(schema.orderLineItems).values({
          id: crypto.randomUUID(),
          orderId: newOrder.id,
          productId: item.productId,
          sku: item.sku,
          title: item.title,
          unitPriceCents: item.unitPriceCents,
          quantity: item.quantity,
          totalCents: item.unitPriceCents * item.quantity,
        });
      }

      return getOrderWithRelations(newOrder.id);
    },

    attachShippingAddress: async (
      _: unknown,
      { orderId, input }: { orderId: string; input: ShippingAddressInput }
    ) => {
      const order = await db.query.orders.findFirst({
        where: eq(schema.orders.id, orderId),
      });
      if (!order) {
        throw new Error(`Order not found: ${orderId}`);
      }
      if (order.status !== 'DRAFT') {
        throw new Error(
          `Order ${orderId} is not in DRAFT status (current status: ${order.status})`
        );
      }

      const dbLineItems = await db.query.orderLineItems.findMany({
        where: eq(schema.orderLineItems.orderId, orderId),
      });

      const machineItems: MachineCartItem[] = dbLineItems.map((item) => ({
        id: item.id,
        productId: item.productId,
        sku: item.sku,
        title: item.title,
        unitPriceCents: item.unitPriceCents,
        quantity: item.quantity,
      }));

      const actor = createCheckoutActor('checkout_draft', {
        cartId: order.cartId,
        items: machineItems,
        subtotalCents: order.subtotalCents,
        shippingCents: order.shippingCents,
        taxCents: order.taxCents,
        totalCents: order.totalCents,
      });

      const machineAddress: MachineShippingAddress = {
        recipientName: input.recipientName,
        addressLine1: input.addressLine1,
        city: input.city,
        postalCode: input.postalCode,
        country: input.country,
      };

      // Zero-trust: Dispatch ATTACH_SHIPPING to state machine
      actor.send({
        type: 'ATTACH_SHIPPING',
        address: machineAddress,
        shippingCents: 500,
      });

      const nextSnapshot = actor.getSnapshot();
      if (nextSnapshot.value !== 'pending_payment') {
        throw new Error(
          'State machine rejected ATTACH_SHIPPING transition (invalid shipping address)'
        );
      }

      // Project shipping address storage to DB
      const existingAddress = await db.query.shippingAddresses.findFirst({
        where: eq(schema.shippingAddresses.orderId, orderId),
      });

      if (existingAddress) {
        await db
          .update(schema.shippingAddresses)
          .set({
            recipientName: input.recipientName,
            addressLine1: input.addressLine1,
            city: input.city,
            postalCode: input.postalCode,
            country: input.country,
          })
          .where(eq(schema.shippingAddresses.orderId, orderId));
      } else {
        await db.insert(schema.shippingAddresses).values({
          id: crypto.randomUUID(),
          orderId,
          recipientName: input.recipientName,
          addressLine1: input.addressLine1,
          city: input.city,
          postalCode: input.postalCode,
          country: input.country,
        });
      }

      // Project order transition to PENDING_PAYMENT
      await db
        .update(schema.orders)
        .set({
          status: 'PENDING_PAYMENT',
          shippingCents: nextSnapshot.context.shippingCents,
          totalCents: nextSnapshot.context.totalCents,
          updatedAt: new Date(),
        })
        .where(eq(schema.orders.id, orderId));

      return getOrderWithRelations(orderId);
    },

    submitPayment: async (
      _: unknown,
      { orderId, input }: { orderId: string; input: PaymentInput }
    ) => {
      // Check idempotency first
      const existingTransaction = await db.query.paymentTransactions.findFirst({
        where: eq(schema.paymentTransactions.idempotencyKey, input.idempotencyKey),
      });

      if (existingTransaction) {
        const order = await getOrderWithRelations(orderId);
        if (!order) {
          throw new Error(`Order not found: ${orderId}`);
        }
        return {
          success: existingTransaction.status === 'CAPTURED',
          transaction: existingTransaction,
          order,
        };
      }

      const order = await db.query.orders.findFirst({
        where: eq(schema.orders.id, orderId),
      });
      if (!order) {
        throw new Error(`Order not found: ${orderId}`);
      }
      if (order.status !== 'PENDING_PAYMENT') {
        throw new Error(
          `Order ${orderId} is not in PENDING_PAYMENT status (current status: ${order.status})`
        );
      }

      const dbLineItems = await db.query.orderLineItems.findMany({
        where: eq(schema.orderLineItems.orderId, orderId),
      });

      const machineItems: MachineCartItem[] = dbLineItems.map((item) => ({
        id: item.id,
        productId: item.productId,
        sku: item.sku,
        title: item.title,
        unitPriceCents: item.unitPriceCents,
        quantity: item.quantity,
      }));

      const actor = createCheckoutActor('pending_payment', {
        cartId: order.cartId,
        items: machineItems,
        subtotalCents: order.subtotalCents,
        shippingCents: order.shippingCents,
        taxCents: order.taxCents,
        totalCents: order.totalCents,
      });

      // Zero-trust step 1: Dispatch SUBMIT_PAYMENT to state machine
      actor.send({
        type: 'SUBMIT_PAYMENT',
        idempotencyKey: input.idempotencyKey,
        amountCents: input.amountCents,
      });

      const processingSnapshot = actor.getSnapshot();
      if (processingSnapshot.value !== 'payment_processing') {
        throw new Error(
          'State machine rejected SUBMIT_PAYMENT: amount mismatch or missing idempotency key'
        );
      }

      // Zero-trust step 2: Gateway succeeds -> Dispatch PAYMENT_SUCCESS
      const paymentTransactionId = crypto.randomUUID();
      actor.send({
        type: 'PAYMENT_SUCCESS',
        paymentId: paymentTransactionId,
      });

      const paidSnapshot = actor.getSnapshot();
      if (paidSnapshot.value !== 'paid') {
        throw new Error('State machine failed to reach paid state');
      }

      // Project payment transaction to DB
      const [transaction] = await db
        .insert(schema.paymentTransactions)
        .values({
          id: paymentTransactionId,
          orderId,
          idempotencyKey: input.idempotencyKey,
          amountCents: input.amountCents,
          currency: input.currency || 'USD',
          status: 'CAPTURED',
          gatewayReference: `gtw_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          errorMessage: null,
        })
        .returning();

      // Project order status transition to PAID
      await db
        .update(schema.orders)
        .set({
          status: 'PAID',
          updatedAt: new Date(),
        })
        .where(eq(schema.orders.id, orderId));

      // Project cart conversion (Cart domain listens to PaymentCaptured)
      await db
        .update(schema.carts)
        .set({
          status: 'CONVERTED',
          updatedAt: new Date(),
        })
        .where(eq(schema.carts.id, order.cartId));

      // Project fulfillment job creation (Fulfillment domain listens to OrderPaidReadyForFulfillment)
      const existingFulfillment = await db.query.fulfillmentJobs.findFirst({
        where: eq(schema.fulfillmentJobs.orderId, orderId),
      });

      if (!existingFulfillment) {
        await db.insert(schema.fulfillmentJobs).values({
          id: crypto.randomUUID(),
          orderId,
          status: 'QUEUED',
        });
      }

      const updatedOrder = await getOrderWithRelations(orderId);
      if (!updatedOrder) {
        throw new Error(`Failed to retrieve order after payment: ${orderId}`);
      }

      return {
        success: true,
        transaction,
        order: updatedOrder,
      };
    },

    dispatchFulfillment: async (
      _: unknown,
      {
        orderId,
        trackingNumber,
        carrier,
      }: { orderId: string; trackingNumber: string; carrier: string }
    ) => {
      const order = await db.query.orders.findFirst({
        where: eq(schema.orders.id, orderId),
      });
      if (!order) {
        throw new Error(`Order not found: ${orderId}`);
      }
      if (order.status !== 'PAID') {
        throw new Error(
          `Order ${orderId} is not in PAID status (current status: ${order.status})`
        );
      }

      const actor = createCheckoutActor('paid', {
        cartId: order.cartId,
        totalCents: order.totalCents,
      });

      // Zero-trust: Dispatch DISPATCH_FULFILLMENT to state machine
      actor.send({
        type: 'DISPATCH_FULFILLMENT',
        trackingNumber,
        carrier,
      });

      const nextSnapshot = actor.getSnapshot();
      if (nextSnapshot.value !== 'fulfilled') {
        throw new Error(
          'State machine rejected DISPATCH_FULFILLMENT transition (missing carrier or tracking number)'
        );
      }

      // Project to DB: Update or insert fulfillment job with SHIPPED status
      const existingJob = await db.query.fulfillmentJobs.findFirst({
        where: eq(schema.fulfillmentJobs.orderId, orderId),
      });

      let fulfillmentJobRecord;
      if (existingJob) {
        const [updated] = await db
          .update(schema.fulfillmentJobs)
          .set({
            status: 'SHIPPED',
            trackingNumber,
            carrier,
            dispatchedAt: new Date(),
          })
          .where(eq(schema.fulfillmentJobs.orderId, orderId))
          .returning();
        fulfillmentJobRecord = updated;
      } else {
        const [inserted] = await db
          .insert(schema.fulfillmentJobs)
          .values({
            id: crypto.randomUUID(),
            orderId,
            status: 'SHIPPED',
            trackingNumber,
            carrier,
            dispatchedAt: new Date(),
          })
          .returning();
        fulfillmentJobRecord = inserted;
      }

      // Project order status to FULFILLED
      await db
        .update(schema.orders)
        .set({
          status: 'FULFILLED',
          updatedAt: new Date(),
        })
        .where(eq(schema.orders.id, orderId));

      return fulfillmentJobRecord;
    },
  },
};
