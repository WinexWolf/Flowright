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
