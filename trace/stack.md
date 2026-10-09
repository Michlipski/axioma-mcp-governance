---
stack: Axioma-Executable-Architecture-V1
---

BACKEND:
- Runtime: Node.js (TypeScript)
- Framework: Next.js App Router (API Routes)
- API: Apollo Server / GraphQL
- State Management: XState v5 (Deterministic State Machine)

DATA:
- Database: PostgreSQL
- ORM: Prisma / Drizzle

FRONTEND:
- Framework: Next.js (React)
- State Integration: @xstate/react
- Client: Apollo Client (GraphQL)
- Styling: Tailwind CSS

SYSTEM DEFAULTS:
- All entities have id (UUID), created_at (Timestamp), and updated_at (Timestamp).
- Money is stored as integer cents (e.g., $19.99 is 1999) with currency string (default 'USD').
- Soft state transitions are strictly governed by XState machine instances before persisting to PostgreSQL.
- Idempotency keys are required on all financial mutations.
- Cross-domain integration operates via structured domain event payloads.
