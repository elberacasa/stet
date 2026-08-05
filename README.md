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
