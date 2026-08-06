# Notes

What working here taught — facts, not preferences.

A rule is a verdict a human gave and every agent must obey. A note is a landmine
somebody already stepped on. Anything may add one; nothing here is binding.

## 1 — the second copy of weakness() lives in src/page.ts; src/rules.ts has the other, and a test extracts and compares them

*Learned 2026-08-06. Globs: src/page.ts, src/rules.ts.*

## 2 — no backticks anywhere inside the PAGE template literal — they terminate the string and break the build

*Learned 2026-08-06. Globs: src/page.ts.*

## 3 — never set loading=lazy on anything inside a container that has not been laid out: it is 0x0, never enters the viewport, and never loads

*Learned 2026-08-06. Globs: src/page.ts.*

## 4 — the provenance line is parsed by reading to the next field label, not the next full stop — a full stop is in almost every real glob

*Learned 2026-08-06. Globs: src/rules.ts, src/notes.ts.*

## 5 — absorbAsset decides by block kind; a new kind carrying a local file must be added to ASSET_FIELD or it will neither be copied in nor renamed

*Learned 2026-08-06. Globs: src/store.ts.*

## 6 — attach a child process close listener at spawn, not after awaiting something else — close fires once and a late listener waits forever

*Learned 2026-08-06. Globs: test/**.*

## 7 — every event named in WIRING must exist in CLAUDE_EVENTS; Claude Code silently never fires a hook for an event it does not emit

*Learned 2026-08-06. Globs: src/claude.ts.*

## 8 — hooks must never throw or block: any failure exits 0 with no output, which Claude Code treats as carry on

*Learned 2026-08-06. Globs: src/hooks.ts.*

## 9 — a test that writes into the tree it runs from cannot be trusted about that tree — spawned hooks need an explicit cwd, or a payload without one falls back to this checkout

*Learned 2026-08-06. Globs: test/**.*

## 10 — the fired-markers in .stet/sessions accumulate from your own session under the gate — a test must assert the suite did not CHANGE them, not that none exist

*Learned 2026-08-06. Globs: test/**.*

## 11 — the session journal is append-only and ordered, so the most recent {t:'p'} before an {t:'e'} is the instruction that caused that edit — no undocumented payload field needed for the join

*Learned 2026-08-06. Globs: src/hooks.ts.*

## 12 — editing this file through a script bypasses the PreToolUse hook, so the no-backticks rule is not enforced there — the build error is the only warning you get

*Learned 2026-08-06. Globs: src/page.ts.*
