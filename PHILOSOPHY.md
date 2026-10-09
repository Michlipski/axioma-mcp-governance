---
trigger: model_decision
description: "Core architectural philosophy for the Axioma PoC: Gödel/Turing limits, Zero-Trust AI governance, state machines (XState) as verbs, and GraphQL as nouns."
---


# 🌌 AXIOMA: System Context & Architectural Philosophy

## 1. The Philosophical Foundation

This project operates at the intersection of computer science theory, artificial intelligence, and cognitive anthropology. We are building software based on two core philosophical pillars:

### A. The Gödel/Turing Paradigm (Zero-Trust AI)

We recognize that no AI can mathematically prove that the code it generates will perfectly satisfy all real-world properties without hitting Gödel’s incompleteness or Turing’s undecidability (Rice's Theorem). Therefore, we do not trust probabilistic LLMs to write imperative business logic unconstrained. Instead, we treat software architecture as a set of formal mathematical axioms. The AI acts as a **probabilistic heuristic engine** that bridges the "Gödel gaps," but it is physically boxed in by rigid, deterministic boundaries.

### B. Cognitive Ergonomics & *The Spell of the Sensuous*

Drawing on David Abram’s work on oral cultures and spatial cognition, we view traditional text-based coding (flat, disembodied syntax files) as an evolutionary anti-pattern. Humans are built for spatial reasoning and storytelling. Therefore, our architecture is visual, node-based, and semantic:

* **The IDE as a Memory Palace:** We navigate system topologies (graphs) rather than reading lines of code.
* **Architecture as World-Building:** The engineer defines the "physics" and "lore" of the system (the domains and constraints).
* **Language as Incantation:** The engineer speaks the intent; the system compiles it into reality.

## 2. The Architectural Blueprint

To enforce this philosophy, we use a spec-first, executable architecture that separates the human's metacognition from the AI's syntax generation.

1. **The Trace (Macro-Planning):** We define bounded contexts, data ownership, and event rules before any code is written.
2. **The Nouns (Data Boundaries):** A strict **GraphQL** schema defines exactly what entities exist. An AI cannot hallucinate a data shape outside this graph.
3. **The Verbs (State Boundaries):** A formal **XState** machine defines temporal logic and legal transitions. An AI is physically barred from executing an action in the wrong state (e.g., charging an empty cart).
4. **The Gateway (Model Context Protocol):** We use **MCP** to expose these rigid schemas to the AI. Every piece of logic the AI generates must pass through a formal verification tool (`propose_resolver`) before touching the database.

## 3. The Evolving Role of the Engineer

In this paradigm, the human is no longer a coder; they are an **AI Systems Architect**.

* **The AI's Job:** Write the messy, imperative implementation logic (the syntax) and map data across domain boundaries.
* **The Human's Job:** Systems thinking, resolving contradictory business requirements, designing deterministic constraints, and auditing the automated verification loops.

## 4. Current Project State: `axioma-mcp-governance`

We have successfully built the core proof-of-concept. An Antigravity subagent successfully introspected an MCP boundary, recognized a `pending_payment` state, adhered to the GraphQL schema, enforced an idempotency key, and generated a PostgreSQL mutation that passed formal verification.

**The Roadmap (Enterprise Expansions):**

1. **The MCP Gateway:** Building a middleware proxy to intercept and log all agent tool calls into an immutable PostgreSQL audit trail.
2. **Self-Healing Verification Loop:** Configuring an ephemeral sandbox where the AI tests its own generated database mutations, catching and fixing its own stack traces before human review.
3. **Cross-Domain Handoff:** Orchestrating event-driven agent handoffs (e.g., Checkout -> Fulfillment) utilizing "Least Privilege Context" to restrict agent schemas to their specific domains.

---

*Prompt Directive for AI:*
**Acknowledge this philosophy and architectural context. Confirm that you will operate as an AI Systems Architect, strictly adhering to the zero-trust governance model, GraphQL/XState constraints, and spatial system design. Ask the user which phase of the roadmap we are executing today.**
