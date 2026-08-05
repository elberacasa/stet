# stet

**Your agents ask once. Your answer stands.**

> `stet` — Latin, *"let it stand."* The proofreader's mark: an editor proposes
> a change, and the author writes `stet` in the margin to overrule it and make
> the original final.

![stet — flip two variants in the same frame, commit a verdict, and watch it become a rule every agent obeys](docs/stet.gif)

```bash
npx stetmark          # run it in any repo
npm i -g stetmark     # then the command is just: stet
```

Zero runtime dependencies. Nothing leaves your machine. No account, no key, no
network.

---

## The problem

A coding agent hits two kinds of fork.

The first has a right answer somewhere in the repository — does this compile,
does this pass, does this match the existing pattern. Agents are good at those
and should never interrupt you.

The second has no right answer anywhere, only a preference. Which type. Which
palette. Which error copy. Modal or page. How much abstraction. Facing that
fork, an agent does one of two things, and both are bad:

- **It guesses.** You find out three hours later that you hate it, and you pay
  for the rebuild.
- **It asks in chat.** You answer, and the answer dies with the session. Next
  week a different agent asks you the same question, and you answer it again,
  slightly differently, forever.

**Human judgment doesn't compound.** That's the actual gap, and it gets worse
the more of your software an agent writes.

## What stet does

Ask once. Record the answer. Make it binding on every agent that touches the
repo from then on.

```
agent hits a fork  →  stet ask < item.json   (writes a small file, blocks, burns nothing)
                   →  you get a notification
                   →  you open a page and judge the real thing
                   →  one line becomes a rule
                   →  the rule is injected into AGENTS.md, CLAUDE.md, .cursorrules…
                   →  the agent unblocks and continues
                   →  every future agent obeys it without asking
```

## The whole thing, not a snippet

A variant is not an excerpt. It's **the real artifact, captured at a matched
set of views** — the same camera position, the same breakpoint, the same
screen — so the only difference in the frame is the thing being decided.

```json
{ "kind": "image", "src": "hero-a.png",    "view": "desktop" },
{ "kind": "image", "src": "hero-a-sm.png", "view": "mobile"  },
{ "kind": "url",   "href": "http://localhost:5173/?variant=A", "view": "live" }
```

| you're building | a view is |
|---|---|
| a landing page | mobile hero, desktop hero, pricing, hover state |
| a game | camera positions in the running client |
| an app | screens, or one screen in three states |
| an API | the response, and the caller code |

Because the views are matched, **press `S` and the variants flip in the same
frame**, pixel for pixel. Side by side is bad at showing a spacing change or a
type swap. Flicker makes it obvious in a quarter of a second.

## Blind until committed

Variant labels are shuffled against what the variants actually are, so you
judge the work and not the approach you already favour. What A and B really
were is revealed only after you commit.

That has a consequence worth designing for: **you can't write a good rule
before the reveal, because you don't yet know what you chose.** So stet takes
your in-the-moment reason first, then — the instant the reveal lands — lets you
sharpen it into the line agents will actually read. It warns you, offline and
deterministically, when a rule can't survive on its own:

```
1. Looks cleaner and much better compared to the option B    ← useless next week
1. Empty states keep the table headers so the screen
   teaches its own shape                                     ← binding
```

## Claude Code: a gate, not a suggestion

```bash
stet claude          # wire it in     ·  stet claude remove  ·  stet claude status
```

Every other human-in-the-loop tool writes instructions into a config file and
hopes. That is the weakest place to put a rule: it is read once at session
start, then competes with every token that arrives after it, and by turn sixty
it is losing to the last thing the agent read.

stet wires into Claude Code's hooks instead, which changes three things:

**Writes into an undecided path are denied.** A pending decision can claim
paths with `globs`. When the agent tries to write there, the tool call is
refused and the question is handed back to it:

```
stet: this path is governed by a decision the human has not made yet.

  api-shape — "Which shape should the list endpoint return?"
  claims: src/api/**

Do not implement either option yet — whichever you pick has a 50% chance of
being thrown away. Either work somewhere else, or block on the verdict with:
  stet await api-shape
```

An instruction can be ignored. A denied tool call cannot. This is the only
reliable way to stop an agent that is trained to finish.

**Rules arrive when they apply.** A rule scoped with `Globs:` is delivered as a
system reminder at the moment the agent writes a matching file — and never
twice in the same session. Measured on a 40-rule canon in a session touching
two of six areas: **1046 tokens always-resident → 538 delivered just in time, a
49% reduction, with 20 rules never sent at all.** Two honest caveats: resident
context is prompt-cached, so the cost saving is smaller than the token saving;
and the real win is placement, not size — a reminder immediately before the
decision beats a preamble sixty turns behind it.

**Taste survives compaction.** `PostCompact` re-states the canon, because
compaction is exactly when your preferences get summarised away.

**And it notices what you never wrote down.** The gate only helps once a
decision exists — but nothing creates one, because an agent trained to finish
does not stop to ask. So stet watches for the same signal from the other side:
`PostToolUse` records *which instruction* caused each write, and when one file
has been revised across three separate instructions, `Stop` says so:

```
stet: unwritten taste detected.

  src/hero.tsx — revised across 3 separate instructions this session
```

Three edits inside one instruction is an agent working. Three edits across
three instructions is a human correcting — and a correction repeated is a
preference nobody has recorded. `stet churn` shows the standing tally. This is
a hypothesis about a signal, not a proven one; the threshold is `--threshold`.

The hooks go in `.claude/settings.local.json`, which is per-developer and not
checked in. That is deliberate: a hook committed to `.claude/settings.json`
points at a binary your teammates may not have installed, and a hook that
cannot run fails on every tool call while gating nothing — the repo would
advertise a protection it is not providing. Use `--project` to share the wiring
once everyone has stet.

Discovery is handled by the surface stet already owns: the `AGENTS.md` block
carries one line telling any agent to prompt its human to run `stet claude` if
the repo is unwired. About twenty tokens, and it works for the teammate who has
never heard of this tool.

Entries are identified by their command, so `stet claude remove` finds them in
either form and restores the file byte for byte. Your own hooks are never
touched. `AGENTS.md` still works for every other agent — this is a layer on
top, not a replacement.

> **Restart your Claude Code session after wiring.** Hooks bind at session
> start, so a session that was already running when you ran `stet claude` will
> not be gated. `stet claude status` tells you whether the wiring is there; only
> a fresh session tells you whether it is live.

## Three doors into the canon

- **Blind A/B** — the highest-quality judgment, because you can't cheat it.
- **Accept / reject one artifact** — an item with a single variant is a
  "good enough to ship?" gate.
- **A correction, typed straight in** — `stet rule "never centre the hero"`,
  for when you've already corrected an agent twice.

All three land in `.stet/RULES.md`, which is the actual product: your
accumulated taste, in plain text, portable, and enforceable by any agent.

## Why it is cheaper, not slower

- A wrong guess costs a full build cycle plus a full rework cycle. Asking costs
  one small JSON file.
- **The artifacts never enter the model's context.** You look at images, audio
  and running builds in a browser. The comparison is free in tokens.
- **`await` blocks on a file watch.** Measured: an agent waiting 17 seconds
  consumed 0.09s of CPU, and the counter did not move while it waited. No
  polling, no tokens.
- A rule is written once and read forever, under a hard token budget.

Measured with a real BPE tokenizer, not estimated:

| canon | characters | tokens |
|---|---|---|
| 1 rule | 278 | **65** |
| 40 rules | 4,478 | **971** |

The default budget is ~1500 tokens. Past it, stet keeps the most recently
earned and most frequently matched rules and **says in the block how many it
held back** — it never truncates silently.

## Commands

```
stet                        init, wire agent surfaces, serve, watch, notify
stet ask < item.json        queue a decision — this is how agents call it
stet await <id> [--timeout] block until decided, print the verdict
stet rule "<one line>"      record a correction straight into the canon
stet rules [--tag design]   print the canon
stet sync [--remove]        re-inject into agent surfaces, or restore them exactly

stet churn                  files this repo keeps having to redo
stet claude [--project]     wire into Claude Code's hooks (see above)
stet claude remove          unwire, restoring settings.json exactly
stet claude status          is it wired?
```

## Where the rules go

Written only into surfaces that already exist, plus `AGENTS.md`, which is
created because it's the one file every agent reads — now a Linux Foundation
standard read natively by Claude Code, Codex, Cursor, Copilot, Gemini CLI,
Windsurf, Aider, Zed and others.

| surface | agent |
|---|---|
| `AGENTS.md` | vendor-neutral — always written |
| `CLAUDE.md` | Claude Code |
| `.cursor/rules/*.mdc`, `.cursorrules` | Cursor |
| `.github/copilot-instructions.md` | Copilot |
| `.windsurfrules` | Windsurf |

Every write is marker-delimited and idempotent. `stet sync --remove` restores
each file byte for byte. stet never creates a config file your repo didn't
already have, except `AGENTS.md`.

## What stet deliberately is not

Not an agent orchestrator. Not a dashboard. Not traffic-based A/B testing. Not
a hosted service, an account, or telemetry. It is a gate, and anything can feed
it.

## Development

```bash
npm install
npm run build          # tsc → dist/
npm test               # vitest

node bin/stet.js       # run it against this repo
```

To try the interface against real input, copy the fixtures in and open the page:

```bash
mkdir -p .stet/pending && cp -R fixtures/* .stet/pending/ && node bin/stet.js
```

Seven fixtures cover every block kind: `code`, `text`, `image`, `diff`, `audio`
and live `url` variants, across matched and unmatched views.

## The package name

The npm package is `stetmark` because npm rejects four-letter names as too
similar to existing ones. The tool, the command, and the idea are `stet`.

## License

MIT © Alejandro Beracasa
