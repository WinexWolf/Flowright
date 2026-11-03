# Competitive landscape and the gaps Flowright targets

Researched November 2026 from public pages and comparison articles. Many comparison posts are written by competing vendors, so treat claims
about other vendors as indicative, and the pricing figures (from one third-party article) as approximate. Nothing here is a benchmark of Flowright against these products.

## Who is doing this

| Category | Examples | What they do |
|---|---|---|
| Agentic / autonomous testing platforms | mabl, Functionize, Katalon, Tricentis, Autify (Aximo), TestMu AI (KaneAI), QA.tech, Momentic, testRigor, Virtuoso | An AI agent writes, runs and maintains end-to-end tests from a goal or a recording. The human role moves from writing tests to reviewing them. Cloud platforms; AI is central. |
| Managed QA | QA Wolf | Engineers plus AI build and own your suite. Roughly $8,000 a month in one article's figures. |
| Visual testing | Applitools, Percy, Chromatic | Screenshot comparison, with "visual AI" to suppress noise. |
| Session replay | Meticulous | Records real user sessions through a script, replays them on every PR with stubbed network, compares screenshots. Chromium only, frontend only. |
| Free, in the framework | Playwright Test Agents (Planner, Generator, Healer), Playwright MCP, Stagehand, browser-use | LLM-driven test generation and repair inside Playwright. Needs a model and an API key. Output is tests you maintain. |
| Accessibility | axe (Deque), Pa11y, Lighthouse | Rule-based scans of a page you point them at. axe is conservative by design; automated checks cover roughly 30 to 40% of WCAG issues. |
| Demos | Storylane, Supademo, Arcade, Clueso | Interactive or video product demos from a capture. Screenshot-based demos go stale when the UI changes. |

## Gaps, and what Flowright does about each

1. **Trust.** The most repeated complaint about AI testing is false results: self-healing that silently re-points a test and hides a regression, "healed" runs that
   pass while the feature is broken, assertions a model invented. *Flowright:* pass/fail is decided by deterministic browser signals; every finding is replayed in fresh
   browsers before it is reported; a flow that stops replaying is surfaced as a regression candidate and never silently healed; models (optional) can only propose, and every
   proposal is verified against the real page.
2. **Cold start.** Session-replay tools need real traffic; agents need prompts; managed services need a contract. *Flowright:* point it at a URL.
3. **Lock-in and maintenance.** Tests live in a vendor platform, or in LLM-written code nobody owns. *Flowright:* `flowright export` writes ordinary Playwright specs
   (journeys, pages, and empty/invalid-input variants) with no Flowright runtime needed.
4. **Privacy.** Cloud AI testing tools typically send page structure, text and screenshots to model providers and keep traces. *Flowright:* nothing leaves the machine by default
   (no model is needed for any measured result); with a model enabled, prompts are redacted of emails, card numbers, tokens, phone numbers and IPs first.
5. **Accessibility is a separate tool and a page-level scan.** *Flowright:* accessibility and keyboard checks run on every discovered *state* (open dialogs, error messages,
   selected tabs included), findings are replay-confirmed like any other, and each gets a repro test. It reports honestly that automated checks are not a full audit.
6. **Existing apps drown in old findings.** *Flowright:* run history marks findings new / still open / fixed, `accept` records "known and fine" with a reason, and
   `--fail-on new` fails a PR only for problems it introduced.
7. **Stale demos.** *Flowright:* demos are rendered from replayable flows, so they can be regenerated on every release (and a flow that no longer replays is not recorded).

## Where competitors are ahead (be honest)

- **Breadth of platform:** cross-browser grids, real-device clouds, native mobile apps, API testing, test management, SSO and audit reports. Flowright is Chromium-only, web-only, and local.
- **Maturity and proof:** these products have customers and years of hardening. Flowright has been run on three small apps its author wrote.
- **Authoring from intent:** "test that a user can reset their password" in plain English. Flowright's goal agent does a basic version; it is not a replacement.
- **Self-maintaining suites at scale:** Flowright deliberately does not auto-heal, which is a trust choice and also more work for the user.

## Not built yet (and why it matters)
Hover-only menus, iframes, shadow DOM, infinite scroll, drag and drop, uploads, multi-factor login; performance metrics (LCP, layout shift); Firefox and Safari engines;
an API-testing layer. Each is a real gap against the platforms above.
