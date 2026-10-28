/** Raw, fingerprint-independent facts observed on a page. Used by both explorers and the benchmark matcher. */
export interface Evidence {
  route: string;            // pathname + search + hash
  title: string;
  headings: string[];       // visible h1-h3 text
  textSample: string;       // visible main text, truncated
  alerts: string[];         // visible [role=alert] text
  dialogs: string[];        // visible dialog text
  selectedTabs: string[];   // names of selected tabs
  overflowX: boolean;       // horizontal overflow of the page
  brokenImages: number;
  emptyMain: boolean;       // route rendered (almost) no visible text
}

export interface RawNode { r: string; k?: RawNode[] }

export interface InteractiveEl {
  role: string; name: string; tag: string; type?: string;
  href?: string; css: string; nth: number; disabled: boolean;
  groupId: number;           // -1 if not part of a field group
  target?: string;
  inModal: boolean;
}
export interface FieldSpec { name: string; type: string; label: string; required: boolean; css: string; options?: string[] }
export interface FormGroup { id: number; fields: FieldSpec[]; submit?: { css: string; name: string; role: string; nth: number } | null; action?: string; method: string; key: string; inModal: boolean }

export interface PageSnapshot {
  evidence: Evidence;
  tree: RawNode[];
  tabs: { name: string; selected: boolean }[];
  interactive: InteractiveEl[];
  forms: FormGroup[];
}

export interface TargetConfig {
  name: string;
  startPath: string;
  sandbox: boolean;                       // sandbox=true allows destructive-looking actions except blockedActionPatterns
  blockedActionPatterns?: string[];       // regex sources, case-insensitive
  allowedHosts?: string[];                // extra hosts besides the base host
  formValues?: Record<string, string>;    // overrides keyed by field name / type / label substring
  staticSegments?: string[];              // URL path segments that must never be generalised to a param
  urlOverrides?: { pattern: string; template: string }[];
  viewport?: { width: number; height: number };
  storageState?: string;                  // saved auth state path
}

export interface Finding { kind: string; route: string; detail: string }

export interface ExplorationResult {
  explorer: string;
  states: { id: string; evidence: Evidence; depth: number }[];
  transitions: { from: string; to: string; action: string }[];
  steps: number;
  ms: number;
  costUsd: number;
  findings?: Finding[];                   // only set by explorers that run an oracle (M2+)
  stats?: Record<string, unknown>;
}

export interface Budget { maxSteps: number; maxTimeMs: number; maxStates?: number }

// ---------------------------------------------------------------- actions, graph, flows, findings (shared plain data)
export type Variant = 'valid' | 'empty' | 'invalid';
export type Action =
  | { kind: 'click'; role: string; name: string; nth: number; css: string; label: string; href?: string }
  | { kind: 'form'; variant: Variant; fields: FieldSpec[]; submit: { css: string; name: string; role: string; nth: number } | null; label: string; method?: string };

export interface Obs {
  consoleErrors: string[]; pageErrors: string[]; failedRequests: string[];
  badResponses: string[];          // "<status> <resourceType> <url>"
  noEffect: boolean;               // no URL change, no state change, no request, no DOM mutation
  domMutated?: boolean; actionError?: string;
  nativeBlocked?: boolean;         // the browser's own form validation stopped the submit (not a dead click)
  settleTimedOut?: boolean;        // the page never went quiet within the settle budget (polling/animation)
}
export interface StateNode {
  id: string; fine: string; coarse: string; treeHash: string; overlay: string;
  url: string; urlTemplate: string; evidence: Evidence; depth: number; path: Action[];
}
export interface Edge { from: string; to: string; label: string; action: Action; obs: Obs }
export interface CrawlGraph { states: StateNode[]; edges: Edge[]; cycles: string[][] }

/** A compiled, replayable flow: plain data, no AI needed to run it. */
export interface Flow {
  id: string; name: string; startPath: string; steps: Action[];
  expect: { route: string; treeHash: string; overlay: string; heading?: string };
}

export type FindingKind = 'console-error' | 'failed-request' | 'broken-link' | 'dead-click' | 'overflow' | 'broken-image' | 'empty-route' | 'missing-validation';
export interface OracleFinding {
  kind: FindingKind; route: string; detail: string;
  severity: 'error' | 'suspect';           // suspect = inferred by comparing probes (form-probe), not a direct browser signal
  signature: string;                       // stable key for dedupe / confirmation
  path: Action[];                          // steps from the start URL that reproduce it (including the triggering action)
  probe?: { valid: Action; variant: Action; from: string };   // missing-validation only
}
