---
domain: Fulfillment
related_domains:
  - Order
---

CONSTRAINTS:
- Fulfillment owns warehouse packaging, dispatch, and parcel carrier integration.
- Fulfillment jobs cannot be spawned manually; they are spawned strictly upon receiving OrderPaidReadyForFulfillment.
- Fulfillment never touches payment records.

GLOSSARY:
- Fulfillment Job: A warehouse dispatch order.
- Tracking Number: Carrier barcode identifier for customer delivery.

# ENTITY: FulfillmentJob
MUST HAVE:
- id: UUID
- order_id: UUID
- status: Enum (Queued, Packing, Shipped, Delivered)
- tracking_number: String (Optional)
- carrier: String (Optional)
- dispatched_at: Timestamp (Optional)

RULES:
- R1: Status transitions: Queued -> Packing -> Shipped -> Delivered.
- R2: tracking_number is required when status moves to Shipped.

# LISTENS TO: OrderPaidReadyForFulfillment (from Order domain)
- Creates FulfillmentJob in Queued status with order_id.

# EVENT: OrderFulfilled
TRIGGER:
- When carrier scans parcel as dispatched (status becomes Shipped).

PAYLOAD:
- fulfillment_id
- order_id
- tracking_number
- carrier
