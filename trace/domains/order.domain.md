---
domain: Order
related_domains:
  - Cart
  - Payment
  - Fulfillment
---

CONSTRAINTS:
- Order owns the frozen commercial contract between shopper and store.
- Order is initialized strictly from a CartCheckoutInitiated event; Orders cannot be constructed from arbitrary ad-hoc items.
- Item pricing in an Order is immutable once created.
- Order does not process payments directly; it listens for payment lifecycle events.

GLOSSARY:
- Order: The legal purchase contract with frozen prices and total calculation.
- Snapshot Item: An immutable record of an item's price and quantity at time of checkout.
- Shipping Address: The destination for physical fulfillment.

# ENTITY: Order
MUST HAVE:
- id: UUID
- order_number: String
- customer_id: UUID (Optional)
- cart_id: UUID
- status: Enum (Draft, PendingShipping, PendingPayment, Paid, Processing, Fulfilled, Cancelled)
- subtotal_cents: Integer
- shipping_cents: Integer
- tax_cents: Integer
- total_cents: Integer

RULES:
- R1: total_cents = subtotal_cents + shipping_cents + tax_cents.
- R2: Status transitions follow strict order: Draft -> PendingShipping -> PendingPayment -> Paid -> Processing -> Fulfilled.
- R3: An Order cannot move to PendingPayment until a valid ShippingAddress is attached.
- R4: total_cents cannot be modified once status reaches PendingPayment.

RELATIONSHIPS:
- Has many OrderLineItem
- Has one ShippingAddress

# ENTITY: OrderLineItem
MUST HAVE:
- id: UUID
- order_id: UUID
- product_id: UUID
- sku: String
- title: String
- unit_price_cents: Integer
- quantity: Integer
- total_cents: Integer

# ENTITY: ShippingAddress
MUST HAVE:
- id: UUID
- order_id: UUID
- recipient_name: String
- address_line1: String
- city: String
- postal_code: String
- country: String

# LISTENS TO: CartCheckoutInitiated (from Cart domain)
- Creates Order in Draft status.
- Copies cart items into immutable OrderLineItem records.
- Computes subtotal_cents.

# EVENT: OrderReadyForPayment
TRIGGER:
- When valid ShippingAddress is attached and shipping method selected.
- Sets Order.status to PendingPayment.

PAYLOAD:
- order_id
- total_cents
- customer_id

# LISTENS TO: PaymentCaptured (from Payment domain)
- Sets Order.status to Paid.
- Emits OrderPaidReadyForFulfillment event.

# EVENT: OrderPaidReadyForFulfillment
TRIGGER:
- Emitted immediately when Order transitions to Paid.

PAYLOAD:
- order_id
- line_items
- shipping_address
