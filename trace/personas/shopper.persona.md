---
persona: Shopper
---

# PERSONA: Shopper

A consumer visiting the e-commerce storefront to purchase goods with low friction, clear pricing, and instant payment validation.

## Goals & Mindset
- Wants a transparent, distraction-free checkout flow.
- Expects rapid feedback if payment details fail or stock runs out.
- Demands deterministic confirmation: an order must never be charged twice.

## Data Access
- Can create and modify their own Cart items while the cart is ACTIVE.
- Can view and attach shipping addresses to their own Order.
- Can submit payment for an Order in PENDING_PAYMENT status.
- Cannot view or alter other shoppers' carts, orders, or payment tokens.
- Cannot directly modify Order status or Fulfillment status (these are driven by system state transitions).
