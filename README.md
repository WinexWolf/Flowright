# Flowright

Test your web app's front-end flows without clicking through them yourself. Flowright explores the app like a user, finds broken behaviour
using deterministic browser signals, **confirms every problem by replaying it from a fresh browser**, and turns each discovered flow into a
replayable artifact. The same flows can be recorded as narrated product demos.

```bash
npm install && npx playwright install chromium
npx tsx packages/cli/src/index.ts analyze http://localhost:3000 --config target.json --out reports/myapp
open reports/myapp/report.html
```

You get: `report.html` (verdict, route map, each problem with screenshot, video, Playwright trace and a runnable repro test), `junit.xml`,
`findings.json`, `flows.json`, `graph.json`. A repro test fails while the bug exists and passes once it is fixed.

## Status: 7 milestones (M0 to M6), all built

| | Milestone | What exists | How it was verified |
|---|---|---|---|
| M0 | Benchmark | 3 target apps, hand-labeled flows, 18 injected bugs, random-click baseline | coverage runs, committed before any explorer |
| M1 | Crawler | state graph, two-level fingerprint, URL templates, replay, safety rules | 3 apps at 100% of labeled states and flows; 14-defect audit (docs/decisions.md) |
| M2 | Oracle, compiler, replayer | findings, replay confirmation, Playwright spec + repro generation | isolated bug injection: dev 9/9, held-out 3/3, 0 false positives on clean apps; generated specs run and behave correctly |
| M3 | LLM layer | provider (Anthropic over fetch), call log + budgets, grounded assertions, flow naming, form values | unit tests against a **scripted stand-in**; **never run against the live API** |
| M4 | Goal agent | one-goal exploration (offline heuristic or LLM policy), flow minimization | real-browser tests with the heuristic policy; LLM policy tested with scripted replies only |
| M5 | CI and reports | pipeline, HTML report, video/trace/screenshot per failure, JUnit, PR-diff selection, CLI, example workflow | pipeline end-to-end test, diff logic on a real git repo, CLI commands executed; **the GitHub workflow has not been run** |
| M6 | Demo layer | narrated recording with cursor, ripple, captions, zoom; desktop and phone; mp4 + captions | rendered and inspected frame by frame; ffprobe checks; **no real text-to-speech engine, captions only** |

Numbers and caveats are in `docs/decisions.md`. Short version: the apps are small and written by the tool's author, so passing them shows the
mechanics work, not that Flowright generalizes. Run it on your own app before trusting it.

## Commands

| | |
|---|---|
| `analyze <url>` | crawl, find problems, confirm by replay, record evidence, write the report. `--diff GITREF` or `--changed a.tsx,b.tsx` verifies only what a change could affect. Exit code 1 if a confirmed problem is found (`--fail-on error|suspect|none`). |
| `agent <url> --goal "..." --success-heading "..."` | pursue one goal and compile the shortest path that reaches it (`agent-flow.json`). Success is decided by checks on the real page. |
| `demo <url> --goal ... --success-heading ...` | record that flow as a narrated demo (`--device phone`, `--no-zoom`). Or `--flows flows.json --flow s5` to record a flow found by `analyze`. |
| `report <dir>` | re-render `report.html` from a previous run without recrawling |
| `diff --base GITREF` | show which routes a change affects |
| `crawl <url> [--dry-run]` | crawl only; `--dry-run` lists what would be clicked and clicks nothing |
| `accept <F-id> --from RUNDIR --reason "..."` | mark a finding as known and fine; it stops failing builds (`unaccept <signature>` undoes it) |
| `history` | the last runs: findings, pages, scope |
| `export --from RUNDIR --out DIR` | turn the journeys of a previous run into a plain Playwright project |

Add `--llm` (needs `ANTHROPIC_API_KEY`) for model-chosen actions, model-named flows, and polished narration; `--llm-forms` for model-suggested form values.
**Nothing requires a key**: every measured result in this repo was produced without a model.

## Target config (`target.json`)

```json
{ "name": "myapp", "startPath": "/", "sandbox": true,
  "blockedActionPatterns": ["log ?out|sign ?out"],
  "formValues": { "email": "demo@example.com", "password": "password123" },
  "fieldValues": { "q": "laptops" },
  "staticSegments": ["profile", "billing"], "viewport": { "width": 1280, "height": 720 } }
```
`sandbox: true` allows destructive-looking actions (delete, place order) except the patterns you block; leave it `false` for anything you care about.
`formValues` match by substring (name, type, label); `fieldValues` match a field's exact name and win over `formValues`.

## Safety model

The explorer clicks everything. So: other hosts are blocked at the network layer; a destructive-action blocklist (by control name **and** link target)
applies in full to any target not declared `sandbox: true`; `confirm()` dialogs are dismissed on non-sandbox targets; non-local hosts need
`--allow-nonlocal`; models can only choose among actions the driver offers. **Run it against a local or ephemeral copy with seeded data, never production.**
Each fresh browser context must see a fresh app state (the replay model depends on it); for a real app that means a resettable seeded database.

## Models propose, deterministic code decides

A model may propose form values, flow names, assertions, narration wording, and which action to try next. Each proposal is validated first:
assertions must be true on the page they were derived from; narration must keep every control name; an agent's chosen action must exist;
success of a goal is an assertion on the real page; pass/fail of a flow is replay. Every call is logged to `llm-calls.jsonl` and capped (default 200).
Cost is reported as $0 unless you supply token prices; none are invented.

## Packages

| package | role | may import |
|---|---|---|
| `core` | types, URL templater, state fingerprint | nothing |
| `driver` | browser session, in-page extractor, settle logic, action performer | core |
| `explorer` | crawler, safe candidate actions, blocklist, graph view | core, driver |
| `oracle` | pure rules over a crawl graph, assertion checker | core |
| `flow-compiler` | graph path to flow; Playwright spec and repro generation | core, driver |
| `replayer` | deterministic replay, confirmation, video/trace/screenshot capture | core, driver, oracle |
| `llm-provider` | the only route to a model; logging, budgets | nothing |
| `semantic` | model-proposed names, assertions, form values (all validated) | core, oracle, llm-provider |
| `agent` | goal-directed exploration and flow minimization | core, driver, explorer, oracle, replayer, llm-provider |
| `report` | self-contained HTML report | nothing |
| `demo` | narration, overlay, recording, ffmpeg encoding | core, driver, llm-provider |
| `engine` | the analyze pipeline, PR-diff selection, JUnit | everything above |
| `benchmark`, `cli` | evaluation harness; command line | everything |

Enforced by `npm run lint:boundaries`. Nothing on the ground-truth path (oracle, replayer, driver, flow-compiler, core) can import a model.

## Tests

```bash
npm test               # ~18 s: unit tests plus real-browser tests (123 tests)
npm run test:e2e       # ~5 min: full pipeline, minimization, demo rendering on real apps
npm run lint:boundaries && npx tsc -p tsconfig.json
npx tsx scripts/verify-specs.ts tasks        # do generated repro specs fail on the buggy app and pass on the clean one?
npx tsx scripts/showcase.ts                  # regenerate the sample report and demos in reports/showcase
```
Needs `ffmpeg` for demos. Timings are from a single-CPU sandbox.

## Known limits

- Small, self-written benchmark apps; real apps will expose gaps (auth/MFA, iframes, shadow DOM, canvas UIs, infinite scroll are unsupported or untested).
- The crawler is thorough, not fast: a 12-page app takes about 3 minutes. Crawls of bug-injected apps are slower.
- Combined bugs can mask each other (a dead "Add to cart" makes checkout unreachable, hiding checkout bugs); evaluation therefore injects one bug at a time.
- Form probing uses generic values; it cannot reach states that need meaningful input (a search that must return results) unless you supply `fieldValues` or use `--llm-forms`.
- Demo zoom is a CSS transform on `<body>`, so a modal that opens during a zoom can sit slightly off for under half a second. Phone mode is viewport and touch emulation with a drawn bezel, not a real device. There is no real voice: the TTS interface exists and is tested with a silent stand-in only.
- The redesigned landing page + app prototype is in `prototype2/index.html` (the earlier text-heavy version is `prototype/`); `npx tsx scripts/audit-prototype2.ts` re-runs its audit.
- The first click-through UI prototype is in `prototype/index.html`; `npx tsx scripts/audit-prototype.ts` re-runs its accessibility audit (axe-core WCAG 2.2 AA on every screen in three themes, plus keyboard, focus, reflow and target-size checks).
- `ci/flowright.yml` is an example that has not been run on GitHub Actions.


## Features beyond the core loop (added after M6)

All deterministic: none of these need a model or an API key. How each was verified is in `docs/decisions.md`.

- **Journeys, not just pages.** A form whose valid submission goes somewhere is a named transaction ("Place order"), with its empty and invalid submissions as variants
  ("the app showed an error, as it should" vs "accepted it anyway"). Pages reached in 3+ steps are named after the button pressed last ("Add to cart").
- **Accessibility and keyboard checks on every page state** (`--no-a11y`, `--no-keyboard` to skip). axe-core WCAG 2.x A/AA rules, plus: is every Tab stop visibly focused, can focus get stuck, are
  there clickable things a keyboard cannot reach. Dialogs and error states are scanned, not only whole pages. Findings are replay-confirmed and get a runnable repro (`@axe-core/playwright`).
  Automated checks cover only part of WCAG: a clean result is not an audit.
- **Visual regression** (`--no-visual` to skip, `--update-baseline` to accept changes). Stable screenshots (animations off, fonts loaded, `visualMask` selectors hidden) are compared with
  baselines in `.flowright/baselines`. A changed page is re-shot in a fresh browser before it is reported. A page whose *structure* changed is a new page, not a visual regression.
  The first run only saves baselines.
- **Run history** in `.flowright/` (commit it): findings are *new*, *still open*, *fixed* or *accepted*; flows that stop replaying are flagged, never silently healed.
  `--fail-on new` fails only for problems a change introduced. "Fixed" is only claimed between two complete runs.
- **Login as session setup.** `auth` in the target config logs in at the start of every fresh session (so replay stays deterministic and recordings start logged in without showing the login);
  `${ENV:NAME}` keeps secrets out of the file; a failed login stops the run loudly instead of silently crawling logged-out. `resetUrl` is POSTed before every session for apps with a shared database.
- **Mobile mode** (`--device mobile`): 390x844 touch device. Also flags a page a phone lays out wider than its screen (the classic missing viewport tag).
- **Export** (`--export DIR`): your journeys as an ordinary Playwright project. No lock-in.
- **CI output:** `summary.md` (PR comment / `$GITHUB_STEP_SUMMARY`), `slack.json` and `--slack-webhook`, JUnit, GitHub annotations.
- **Privacy:** if a model is enabled, prompts are redacted of emails, card numbers (Luhn-checked), tokens, phone numbers and IPs before they leave the machine. Pattern-based: a safety net, not a guarantee.

```json
{ "name": "myapp", "startPath": "/", "sandbox": true,
  "auth": { "loginPath": "/login", "fields": { "email": "qa@example.com", "password": "${ENV:QA_PASSWORD}" }, "submit": "Sign in", "successPath": "/dashboard" },
  "resetUrl": "/__reset", "device": "desktop", "visualMask": [".clock", ".avatar"] }
```

How this compares with other tools, and the gaps it targets: `docs/competitive-landscape.md`.
