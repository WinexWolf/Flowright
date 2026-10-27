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
export interface FormGroup { id: number; fields: FieldSpec[]; submit?: { css: string; name: string; role: string; nth: number } | null; action?: string; key: string; inModal: boolean }

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
