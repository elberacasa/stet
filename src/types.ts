// stet — shared shapes. Nothing here imports anything; everything else imports this.

/**
 * `view` is the matched-capture key and the reason this tool works on whole
 * artifacts instead of snippets: every variant renders the same named views —
 * the same camera position, the same breakpoint, the same screen — so the only
 * difference in the frame is the thing being decided. Blocks that share a view
 * are laid out together and can be flipped in place.
 */
interface Base {
  title?: string;
  view?: string;
}

export type Block =
  | (Base & { kind: 'code'; lang?: string; text: string })
  | (Base & { kind: 'diff'; path: string; text: string })
  | (Base & { kind: 'text'; text: string })
  | (Base & { kind: 'image'; src: string })
  | (Base & { kind: 'audio'; src: string })
  | (Base & { kind: 'url'; href: string });

export interface Variant {
  label: string;
  blocks: Block[];
}

export interface Item {
  id: string;
  created: string;
  question: string;
  notes?: string;
  /** How to judge — what to look at first. */
  how?: string;
  tags?: string[];
  globs?: string[];
  /** The blind test. Never leaves the server before a verdict is recorded. */
  map: Record<string, string>;
  variants: Variant[];

  // Added on decision.
  verdict?: string;
  because?: string;
  revealed?: string;
  rule?: string;
  decidedAt?: string;
}

/** What the page is allowed to see while a decision is still pending. */
export type BlindItem = Omit<Item, 'map'>;

export interface Rule {
  n: number;
  /** The one line that gets injected. */
  text: string;
  from?: string;
  earned?: string;
  tags: string[];
  globs: string[];
  /** Full prose the human wrote, first line included. */
  body: string;
  /** How often this rule has been matched into a surface. Reserved; 0 in v0. */
  hits: number;
}

/** An entry on disk — parsed, or deliberately surfaced as broken. */
export type Entry =
  | { ok: true; id: string; dir: string; state: 'pending' | 'decided'; item: Item }
  | { ok: false; id: string; dir: string; state: 'pending' | 'decided'; error: string };

export interface Surface {
  /** Repo-relative path. */
  path: string;
  agent: string;
  /** Written even when absent (only AGENTS.md). */
  always?: boolean;
  /** Created by stet, so --remove deletes it. */
  created?: boolean;
}
