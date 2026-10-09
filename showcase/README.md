# Axioma Showcase: Zero-Trust LLM Governance Flight Simulator

> A 2-minute architectural brief for CTOs, Engineering Leaders, and Systems Architects evaluating deterministic LLM governance.

---

## 1. Executive Thesis

Large Language Models are probabilistic next-token predictors. Entrusting autonomous agents with direct, imperative write access to production databases or payment APIs is an unacceptable operational risk.

**Axioma bypasses Gödel/Turing limits of AI code generation by treating software architecture as a formal axiomatic system:**
* **The Nouns (Data Graph Boundaries):** A rigid GraphQL AST schema explicitly defines what entities, mutations, and field types exist.
* **The Verbs (Temporal State Boundaries):** An XState v5 finite state machine mathematically dictates admissible transitions, temporal ordering, and invariant guards (`empty_cart` $\to$ `cart_active` $\to$ `checkout_draft` $\to$ `pending_payment` $\to$ `paid` $\to$ `fulfilled`).
* **The Lens (Zero-Trust MCP Gateway):** Every tool invocation traverses an auditing JSON-RPC proxy on port `3001` before reaching the core Model Context Protocol (MCP) server on port `3000`.
* **The Immutable Audit Ledger:** Every interception is recorded in PostgreSQL (`agent_audit_logs`) with verified mathematical status (`INTERCEPTED`, `APPROVED`, or `REJECTED`).

```
                    ┌──────────────────────────────────────────────┐
                    │          Autonomous LLM Subagents            │
                    │        (Probabilistic Code Synthesizers)     │
                    └──────────────────────┬───────────────────────┘
                                           │ JSON-RPC (tools/call)
                                           ▼
                    ┌──────────────────────────────────────────────┐
                    │         Axioma MCP Gateway (:3001)           │
                    │   - Non-mutating proxy & interceptor         │
                    │   - Audit write to PostgreSQL                │
                    └──────────────────────┬───────────────────────┘
                                           │
                        ┌──────────────────┴──────────────────┐
                        ▼                                     ▼
      ┌──────────────────────────────────┐  ┌──────────────────────────────────┐
      │   PostgreSQL: agent_audit_logs   │  │   Axioma MCP Server (:3000)      │
      │   - Status: INTERCEPTED          │  │   - XState Guard Evaluator       │
      │   - Status: APPROVED / REJECTED  │  │   - GraphQL AST Conformance      │
      └──────────────────────────────────┘  └──────────────────────────────────┘
```

---

## 2. The Core State Invariants

In standard agent architectures, an LLM might hallucinate a `submitPayment()` call on an empty shopping cart or apply an unvetted 90% coupon after payment authorization.

In Axioma, **such transitions do not exist in the state space**:

1. **State `empty_cart`:**
   - Admissible Events: `ADD_ITEM` only.
   - Guarded: Transitions such as `APPLY_DISCOUNT`, `SUBMIT_PAYMENT`, or `INITIATE_CHECKOUT` are absent from the state definition. Attempting them results in an immediate `REJECTED` verdict (`ILLEGAL_STATE_TRANSITION`).
2. **State `checkout_draft`:**
   - Admissible Events: `APPLY_DISCOUNT`, `REMOVE_DISCOUNT`, `ATTACH_SHIPPING`, `CANCEL_CHECKOUT`.
   - Invariant: Advancing to `pending_payment` requires a complete, validated shipping address.
3. **State `pending_payment`:**
   - Admissible Events: `SUBMIT_PAYMENT`, `CANCEL_CHECKOUT`.
   - Invariant Guards:
     - `hasIdempotencyKey`: Must supply a non-empty `idempotencyKey`.
     - `validPositiveAmount`: `amountCents` must strictly match the calculated order `totalCents`.
     - Verified Database Implementation: Resolver AST must verify existing transaction before inserting.
4. **State `paid` (Commercial Contract Settled):**
   - Irreversible: Transitions solely to `fulfilled` via `DISPATCH_FULFILLMENT` with carrier and tracking data.

---

## 3. Preserved Showcase Scenarios

Declarative JSON fixtures under `showcase/scenarios/` provide reproducible payloads for evaluating agent boundaries:

| Fixture | Scenario | Expected Verdict | Reason |
| :--- | :--- | :--- | :--- |
| [`01-illegal-discount-on-empty-cart.json`](./scenarios/01-illegal-discount-on-empty-cart.json) | Rogue Agent: Attempt Discount on Empty Cart | `REJECTED` | `APPLY_DISCOUNT` is mathematically impossible from `empty_cart`. |
| [`02-valid-checkout-and-payment.json`](./scenarios/02-valid-checkout-and-payment.json) | Compliant Agent: Execute Legal Payment | `APPROVED` | Satisfies state guards, idempotency check, and amount invariants. |
| [`03-missing-idempotency-key.json`](./scenarios/03-missing-idempotency-key.json) | Rogue Agent: Submit Payment Without Idempotency Key | `REJECTED` | Missing required idempotency key violates payment safety guard. |

---

## 4. Running the Simulation

### Step 1: Start Services

```bash
# 1. Start Core MCP Server (Port 3000)
npm run mcp:server

# 2. Start MCP Zero-Trust Gateway (Port 3001)
npm run mcp:gateway

# 3. Start Next.js Development Server (Port 3000 or 3002)
npm run dev
```

### Step 2: Open the Flight Simulator

Navigate to **`http://localhost:3000/showcase`** in your browser.

* **Topology & Active State Viewer:** Real-time visual finite state machine node highlighting legal vs. illegal transitions.
* **Agent Intent Dispatcher:** Single-click preset scenario triggers dispatched directly to the MCP Gateway (`http://localhost:3001`), plus a custom JSON-RPC payload editor.
* **Live Audit Stream:** Polling feed from `agent_audit_logs` displaying instant status chips (`INTERCEPTED`, `APPROVED`, `REJECTED`) and expandable JSON inspectors.

### Step 3: Run Automated Verification Tests

```bash
npm test
```
Runs 36+ unit and invariant tests covering the XState machine, MCP Gateway telemetry, resolver verification, and GraphQL projection.
