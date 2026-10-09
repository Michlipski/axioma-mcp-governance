---
name: self-healing-verification
description: >-
  Enforce the Axioma Self-Healing Verification Loop directive whenever synthesizing or reviewing
  GraphQL resolvers, database mutations, or state machine transitions. Runs npm run test:sandbox,
  evaluates exit codes, captures stderr stack traces, and re-invokes subagents up to 3 times to
  self-heal before delivering a formal review artifact.
---

# Self-Healing Verification Loop Directive

This skill establishes the zero-trust self-healing loop for Antigravity code generation within the Axioma architecture.

## Directives

When generating or evaluating a proposed GraphQL resolver or database mutation:

### 1. Step A (Execute Sandbox)
Save the candidate proposal into `scratch/proposal.json` (or the relevant resolver file) and run:
```bash
npm run test:sandbox
```

### 2. Step B (Evaluate)
Inspect the process exit code and stdout/stderr output:
* If **Exit Code == 0**: Proceed immediately to Step 4 (Artifact Handoff).
* If **Exit Code > 0**: Proceed to Step 3 (Self-Heal).

### 3. Step C (Self-Heal Iteration)
Do **NOT** present broken code to the human for review.
1. Extract the exact stack trace, assertion failure, or compiler error from `stderr` or terminal output.
2. Re-invoke the code-generating subagent (or execute an internal self-repair step) with the prompt:
   > "The proposed resolver failed execution in the sandbox. Analyze the following stack trace, identify the logical or type error, and output a patched implementation:
   > [INSERT STACK TRACE & REJECTED REASONS]"
3. Apply the patched code and repeat Steps A–C.
4. Allow up to a maximum of **3 iterations**. If 3 attempts fail, document all 3 failure traces in the escalation report.

### 4. Step D (Artifact Handoff)
Only when `npm run test:sandbox` exits with code `0`:
* Compile the verified resolver code, the state machine invariants satisfied, and the passing sandbox test output into a Markdown Artifact (`VERIFICATION_ARTIFACT.md`).
* Present the verified artifact to the human for metacognitive review.
