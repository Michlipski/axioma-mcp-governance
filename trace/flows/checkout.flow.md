---
flow: CheckoutFlow
persona: Shopper
domains:
  - Cart
  - Order
  - Payment
  - Fulfillment
---

# WORKFLOW: End-to-End E-Commerce Checkout
> GOAL: Guide the shopper smoothly through item review, shipping information, secure payment, and confirmation.

## SCREEN: Cart Review
- DATA: List of CartItem (title, quantity, unit_price_cents), Cart subtotal.
- If Cart is empty:
  - Display "Your cart is empty. Add items to begin checkout."
  - "Proceed to Checkout" button is disabled.
- ACTION: Update item quantity -> Recalculates subtotal.
- ACTION: "Proceed to Checkout" (disabled if empty) -> Triggers CartCheckoutInitiated, Goes to SCREEN: Shipping Details.

## SCREEN: Shipping Details
- DATA: Form fields (Recipient Name, Address Line 1, City, Postal Code, Country), Order items summary.
- ACTION: "Back to Cart" -> Unlocks Cart, returns to SCREEN: Cart Review.
- ACTION: "Continue to Payment" (validates shipping fields) -> Triggers OrderReadyForPayment, Goes to SCREEN: Payment Submission.

## SCREEN: Payment Submission
- DATA: Order summary, total_cents breakdown, credit card input fields.
- Form generates a unique idempotency key on load.
- ACTION: "Pay Now" -> Disables submit button, enters loading state, dispatches payment intent.
  - If Payment succeeds -> Goes to SCREEN: Order Confirmation.
  - If Payment fails -> Shows error banner, enables retry with refreshed idempotency key.

## SCREEN: Order Confirmation
- DATA: Order number, items list, total paid amount, delivery estimate, and initial FulfillmentJob status (Queued/Processing).
- ACTION: "Continue Shopping" -> Resets to fresh active cart.
