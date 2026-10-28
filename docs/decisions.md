# Decisions and known risks

## Decisions

**D1. npm workspaces + tsx, not pnpm.** Fewer moving parts in the sandbox. Packages export TS source directly (no build step).

**D2. State identity is two-level.** `coarse` = URL template + structural role tree with overlays removed. `fine` = coarse + overlay
structure (dialogs, alerts, status) + selected tab positions. Text, ids, and data values never enter identity.
Repeated siblings are bucketed 0 / 1 / many, so a 3-item list equals a 40-item list but an empty list differs from a populated one.

**D3. URL templates are static rules + learned slugs.** Numeric ids, UUIDs and long hex are always params. A segment (depth >= 1)
becomes `:slug` once its parent has been seen with >= 3 distinct children. Early states are re-merged at the end of the crawl
(`fineFrom`) because templates may be learned after they were registered. Declare `staticSegments` in the target config to protect
real static children (e.g. /settings/profile|billing|security), see risk R5.

**D4. Fresh browser context per branch; reach states by replaying the action path from the start URL.** The target app must give
each fresh context a fresh world (the bench apps do this per cookie session). Alternative considered: restoring `storageState`
snapshots. It is cheaper for deep paths but cannot restore in-memory SPA state (open modals, client routes), so replay is the default.

**D5. Shallowest-first priority + per-element-key cap (default 2).** The same (role, name, href-template) action is attempted at most twice
across all states, so nav links that exist on every page don't dominate the budget. Observed effect: ~65% of candidate actions are
skipped by the cap on both dev apps. This trades breadth of repetition for termination.
Known cost: a bug that only manifests on the 3rd+ instance of a repeated control can be missed.

**D6. Form probing uses three deterministic variants: valid, empty, invalid.** Values come from `formValues` overrides then
type/name heuristics. An LLM replaces this in M3. Empty/invalid submissions are what reveal validation-error states.

**D7. Settle = network quiet AND DOM quiet, and the action itself counts as activity.** (See incident I1.)

**D8. Safety defaults.** Same-host containment (other hosts are aborted at the network layer), `sandbox:false` targets get the full
destructive-action blocklist, the CLI refuses non-local hosts without `--allow-nonlocal`, dry-run mode lists actions without executing any.

**D9. Benchmark integrity.** Labels and bug registry were committed before any explorer existed. The matcher uses only user-visible evidence,
never the explorer's fingerprint. The held-out app (library) is refused by the runner without `--include-heldout`, and is run once per
milestone after the explorer is frozen.

## Incidents found by measuring (not by inspection)

**I1. Stale snapshots on single-page apps (caused 14 replay-drift events, 6/13 coverage).** Network-only settling returned before a
hashchange handler had started its fetch, so the snapshot showed the previous route's DOM under the new URL. Fix: settle also waits for DOM
mutations to stop, and treats the action as activity. Drift went to 0.

**I2. Modals invisible to the fingerprint (9/13 coverage).** The tree walker pruned containers with a zero-size box, and a wrapper around
a `position:fixed` modal has no box. The whole dialog subtree was dropped. Fix: prune containers only when truly hidden; require size only
for leaves. Regression test added.

**I3. Harness hang.** `stop()` waited forever on a child that had already exited. Fixed, and unexpected target exits are now logged.

## Risks / limitations (open)

- **R1. Native browser validation vs probes.** `required` / `type=email` fields block submission in the browser, so some "empty"/"invalid"
  submits produce no request and no state change. The M2 oracle must not report these as dead clicks.
- **R2. Toasts and text-only changes are not state.** A "Saved" toast changes text but not structure, so it is invisible to identity.
  Intent assertions in M3 are the planned fix.
- **R3. Heuristic form values.** The crawler cannot reach states that need meaningful input (e.g. a search that returns hits). The held-out
  library app contains one such state on purpose.
- **R4. Cycles report is noisy.** Any app with a home link forms one giant strongly-connected component. Useful as a termination check, not as a finding.
- **R5. Learned-slug heuristic can over-generalise** three distinct static children under one parent. Mitigated by `staticSegments`.
- **R6. Auth/MFA, iframes, shadow DOM, canvas UIs** are unsupported or untested.
- **R7. Replay flakiness is measured only indirectly (drift count).** Proper replay-success-rate measurement is the M2 replayer's job.
- **R8. The benchmark apps are small and written by the tool's author.** Passing them shows the mechanics work, not that the tool generalises. The first real target app is the next honest test.


---

## M1 audit (second pass): bugs found by reading the code, then confirmed by measurement

The first M1 report said "coverage 16/16 and 13/13". A held-out app run then exposed misses (12/13 states, 5/7 flows), and diagnosing them
led to a systematic review of the crawler. Fourteen defects were found and fixed:

| # | Defect | Effect | How it was found |
|---|---|---|---|
| A1 | Replay-drift check compared against the fingerprint recorded at discovery, but URL templates are learned later in the crawl | states first seen under a literal slug (`/books/dune`) "drifted" and their whole task was silently dropped; the *Reserve* flow never ran | held-out miss -> 4 drift events in stats |
| A2 | States were never re-keyed when a template was learned | duplicate states kept being expanded | code review |
| A3 | Per-element cap was global | stateful controls (the Browse dropdown) were only tried from the first two pages, so *books -> genre* had no recorded path | held-out miss |
| A4 | A drifted task was dropped (no retry) and still consumed its cap slot | work lost, amplifying A1 | code review |
| A5 | Failed actions were recorded as graph self-edges | fake transitions in the graph, inflated cycles | code review |
| A6 | Duplicate-edge merge kept only the first instance's observations | a console error seen on the 2nd instance could be lost | code review |
| A7 | Native browser validation (`required`, `type=email`) looked like a dead click | would be a false positive in the oracle | known risk R1, now detected (`obs.nativeBlocked`) |
| A8 | `settle()` silently gave up after its timeout | possibly-unsettled snapshot trusted | code review; now counted (`settleTimeouts`) |
| A9 | Target server crashed on malformed JSON | harness flakiness | review |
| A10 | Standalone checkboxes/radios/switches were never exercised | whole class of controls untested | code review |
| A11 | Role-less clickables (`div onclick`, `cursor:pointer`) were invisible | common in real apps | code review |
| A12 | `confirm()` dialogs auto-accepted even on non-sandbox targets | safety: could confirm a destructive action | code review |
| A13 | Blocklist looked at link text only | a link named "Sign off" pointing at `/logout` would be clicked | code review |
| A14 | Browser leaked if the first page load threw | resource leak | code review |

Also fixed: `javascript:` links were mis-classified as external (now in-page handlers); `mailto:`/`tel:` are skipped as leaving the app.

Measured effect (crawler, coverage of hand-labeled states/flows, clean apps):

| app | before audit | after audit | steps before -> after | time before -> after |
|---|---|---|---|---|
| shop | 16/16, 8/8 | 16/16, 8/8 | 61 -> 182 | 60s -> 174s |
| tasks | 13/13, 7/7 | 13/13, 7/7 | 57 -> 91 | 52s -> 73s |
| library | 12/13, 5/7 | 13/13, 7/7 | 74 -> 427 | 77s -> 450s |

Replay drift is 0 on all three, no tasks were dropped, and the library's duplicate state is now merged mid-crawl.
**Cost of A3:** scoping the cap per page structure removes nearly all skipping (shop: 125 skipped -> 4), which is why steps and time rose 2-6x.
That is the price of not being systematically blind to stateful controls; a smarter cap (by observed effect, not by structure) is future work.
The library app is no longer a held-out *coverage* app: it was diagnosed. Its original pre-diagnosis result (12/13, 5/7) stands as the honest held-out number.

## Provenance note

When this audit started, the repository already contained M2 code (oracle, replayer, flow compiler, `driver` package, evaluation harness,
`errata.json`) that was **not written in the session that did M0/M1 and had no documentation**. It was treated as unreviewed code:
read in full, tested, and re-evaluated. Two integrity issues were found and fixed:

1. `bugs.json` carried a note claiming the original strict match results were kept in this file. They were not. The original strict rules are now stored
   as `matchOriginal` on the two bugs whose rules were widened after dev results were seen (`shop-layout-overflow`, `tasks-failing-api`), and recall is reported under both rule sets.
2. `errata.json` excused a finding (`tasks-edit-title-unvalidated`) as a "real defect in the clean app". It *was* real (the edit endpoint accepted blank titles), so the app was fixed
   instead of the finding being excused. The errata entry stays for history and no longer matches anything.
