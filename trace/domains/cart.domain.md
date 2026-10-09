---
domain: Cart
related_domains:
  - Order
---

CONSTRAINTS:
- Cart owns transient item selection and quantity changes only.
- When checkout starts, Cart enters LOCKED_FOR_CHECKOUT and rejects any further item edits.
- Cart does not calculate shipping rates or sales tax; it computes item subtotal only.
- When an order is paid, Cart marks its status as CONVERTED.

GLOSSARY:
- Cart: The customer's pre-checkout container.
- Cart Item: A SKU with a designated positive quantity.

# ENTITY: Cart
MUST HAVE:
- id: UUID
- customer_id: UUID (Optional)
- status: Enum (Active, LockedForCheckout, Converted, Abandoned)
- created_at: Timestamp
- updated_at: Timestamp

RULES:
- R1: A Cart can only add, remove, or update items when status is Active.
- R2: An empty cart cannot initiate checkout.
- R3: Status transitions: Active -> LockedForCheckout -> Converted (or Abandoned).

RELATIONSHIPS:
- Has many CartItem

# ENTITY: CartItem
MUST HAVE:
- id: UUID
- cart_id: UUID
- product_id: UUID
- sku: String
- title: String
- unit_price_cents: Integer
- quantity: Integer

RULES:
- R1: quantity must be an integer >= 1.
- R2: unit_price_cents must be >= 0.

# EVENT: CartCheckoutInitiated
TRIGGER:
- When Shopper requests checkout on an Active cart with at least one item.
- Sets Cart.status to LockedForCheckout.

PAYLOAD:
- cart_id
- customer_id
- items (list of product_id, sku, title, unit_price_cents, quantity)
- subtotal_cents

# LISTENS TO: PaymentCaptured (from Payment domain)
- Sets Cart.status to Converted.
