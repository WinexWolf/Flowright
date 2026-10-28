# Flowright

Autonomous testing of web-app front-end flows: explore an app like a user would, find broken behaviour with deterministic
browser signals, and compile every discovered flow into a replayable artifact. (A later milestone renders those same flows into product demos.)

## Status: 7 milestones (M0-M6)

| | Milestone | State |
|---|---|---|
| M0 | Benchmark: 3 target apps, hand-labeled flows, 18 injected bugs, baselines | done |
| M1 | Deterministic crawler, state graph, two-level fingerprint | done (+ audit, see docs/decisions.md) |
| M2 | Oracle, flow compiler, replayer, bug-recall + replay evaluation | done (see docs/decisions.md for measured numbers and caveats) |
| M3 | LLM form-filling, flow naming/clustering, intent assertions | not started |
| M4 | Goal-directed agent for flows the crawler cannot reach | not started |
| M5 | CLI polish, CI action, PR-diff-aware runs, traces/video per failure | not started |
| M6 | Demo layer: narration, DOM-coordinate zooms, cursor smoothing, device frames | not started |

## Packages

| package | role | may import |
|---|---|---|
| `core` | shared types, URL templater, state fingerprint | nothing from flowright |
| `driver` | browser session, in-page extractor, settle logic, action performer | core |
| `explorer` | crawler (state graph), blocklist, graph visualisation | core, driver |
| `oracle` | pure rules over a crawl graph -> findings (no browser, no AI) | core |
| `flow-compiler` | graph path -> replayable Flow; Playwright spec + finding repro generation | core, driver |
| `replayer` | deterministic replay, replay-rate measurement, finding confirmation | core, driver |
| `benchmark` | target apps' labels, baselines, coverage + oracle evaluation | everything |
| `cli` | `flowright crawl` | explorer |

`oracle` and `replayer` must never import `llm-provider` or `agent` (enforced by `npm run lint:boundaries`).

## Commands

```bash
npm install
npm test                                    # unit tests (fast, ~3s)
npm run lint:boundaries
npx tsc -p tsconfig.json                    # typecheck

# coverage of hand-labeled flows (dev apps; add --include-heldout for the held-out app)
npx tsx packages/benchmark/src/run.ts --explorer noop,random,crawler --apps shop,tasks --steps 600 --time 500000

# oracle + replay evaluation (isolated: one injected bug per crawl)
npx tsx packages/benchmark/src/run.ts --oracle --bugs dev --apps shop,tasks --replay-runs 10 --out reports/oracle-dev.json

# crawl any LOCAL app (refuses non-local hosts without --allow-nonlocal; --dry-run lists actions without executing any)
npx tsx packages/cli/src/index.ts crawl http://localhost:3000 --config target.json --out reports/myapp

# verify that generated Playwright specs run, and that finding repros fail on the buggy app but pass on the clean one
npx tsx scripts/verify-specs.ts tasks
```

Single-CPU sandbox timings are in docs/decisions.md; a full oracle evaluation takes tens of minutes.

## Safety model

The explorer clicks everything, so: same-host containment (other hosts are aborted at the network layer), a destructive-action blocklist
(name AND link target) applied in full to any target not declared `sandbox: true`, `confirm()` dialogs are dismissed on non-sandbox targets,
non-local hosts need `--allow-nonlocal`, and `--dry-run` lists what would be done. Run it against a local/ephemeral copy with seeded data,
never production.
