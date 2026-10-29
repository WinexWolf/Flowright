# Project: Flowright

Autonomous testing of web-app front-end flows: explore an app like a user would, find broken behaviour with deterministic browser signals,
confirm each problem by replay, and compile every discovered flow into a replayable artifact. The same flows render into narrated product demos.

## Core principle: models PROPOSE, deterministic code DECIDES
- Ground truth (no AI, ever): a real browser, DOM/structure, console + network errors, replay. A bug is a "failure" only if this layer shows it.
- Models may propose form values, flow names, assertions, narration wording, and which action to try next.
  Every proposal is validated before it is used: assertions must be TRUE on the page they were derived from, narration must keep every control name,
  an agent's chosen action index must be in range, and goal success is decided by assertions on the real page.
- Subjective UX opinions never fail a run.

## Boundary rules (enforced by `npm run lint:boundaries`, scanning every package's src/)
core imports nothing. oracle -> core only. replayer -> core, driver, oracle. driver -> core. flow-compiler -> core, driver.
llm-provider and report import nothing of ours. explorer/semantic/agent/demo never import benchmark, cli or engine.
Nothing in the ground-truth path (oracle, replayer, driver, flow-compiler, core) may import llm-provider, semantic or agent.

## Working rules
- Never claim something works without running it and showing output. Say plainly what was NOT verified.
- Benchmark honesty: labels and injected bugs are written BEFORE the explorer they grade. Held-out data is run once per milestone; never tune on it.
- Never let the explorer take destructive actions outside a sandbox target.
- Ambiguous decisions and defects found are recorded in docs/decisions.md.
- Prefer deterministic solutions over LLM calls. Every LLM call is logged (inputs, outputs, usage) and budget-capped.
