---
domain: Payment
related_domains:
  - Order
---

CONSTRAINTS:
- Payment owns transaction execution, idempotency, and gateway interaction.
- Payment cannot initiate unless an Order is in PendingPayment status.
- Amount charged must equal Order.total_cents exactly.
- Duplicate charges are mathematically prevented using unique idempotency keys.

GLOSSARY:
- Payment Transaction: An attempt to settle funds via a payment gateway.
- Idempotency Key: A client-provided unique string guarding against double charges.

# ENTITY: PaymentTransaction
MUST HAVE:
- id: UUID
- order_id: UUID
- idempotency_key: String
- amount_cents: Integer
- currency: String
- status: Enum (Pending, Authorized, Captured, Failed, Refunded)
- gateway_reference: String (Optional)
- error_message: String (Optional)

RULES:
- R1: idempotency_key must be unique across all transactions.
- R2: If a transaction with the same idempotency_key is already Captured or Pending, return the existing transaction without re-charging.
- R3: A transaction cannot be created with amount_cents <= 0.

# EVENT: PaymentCaptured
TRIGGER:
- When gateway successfully settles the transaction.
- Sets PaymentTransaction.status to Captured.

PAYLOAD:
- payment_id
- order_id
- amount_cents
- captured_at
- gateway_reference

# EVENT: PaymentFailed
TRIGGER:
- When gateway declines or network fails.
- Sets PaymentTransaction.status to Failed.

PAYLOAD:
- payment_id
- order_id
- error_message
