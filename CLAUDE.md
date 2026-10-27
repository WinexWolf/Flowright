# Project: Flowright

An autonomous tool that explores a web app's frontend, discovers user flows,
tests them for bugs without manual clicking, and compiles each verified flow
into a replayable artifact. A later phase renders those same flows into
product demo videos. Testing comes first; demos reuse its output.

## Core principle: separate perception, judgment, and ground truth
- Ground truth (deterministic, NO AI): Playwright-driven real browser, DOM state,
  accessibility structure, console errors, network failures. A bug is only a
  "failure" if this layer can show it.
- Exploration (AI-assisted, later milestones): an LLM chooses what to try next
  or names flows. It never decides pass/fail on its own.
- Judgment: subjective UX opinions are advisory only and never fail a run.

## Boundary rule (enforced by `npm run lint:boundaries`)
`oracle` and `replayer` must never import `llm-provider` or `agent`.
`core` imports nothing from other flowright packages.

## Rules for working in this repo
- Never claim something works without running it and showing output.
- Every milestone has acceptance criteria; report measured numbers.
- Benchmark honesty: labels and injected bugs are written BEFORE the explorer
  they grade. Held-out apps/bugs are not run during development; run once at
  the end of a milestone and do not tune to them afterwards.
- Never let the explorer take destructive actions outside a sandbox target.
- Ambiguous decisions are logged in docs/decisions.md.
- Prefer deterministic solutions over LLM calls.
