# stet

**Claude Code cannot be told to stop guessing. It can be stopped.**

Your agent hits a fork with no right answer — which type, which copy, modal or
page — and it does what it was trained to do: it picks one and keeps going. You
find out three hours later. stet turns that fork into a *denied tool call*, puts
the two options in front of you as the real running thing, and turns your answer
into a rule every future agent obeys without asking.

> `stet` — Latin, *"let it stand."* The proofreader's mark: an editor proposes
> a change, and the author writes `stet` in the margin to overrule it and make
> the original final.

![stet — two signup flows running side by side, judged blind; the verdict reveals which was which and becomes a rule every agent obeys](docs/stet.gif)

```bash
npx stetmark@latest demo
```

Seven real decisions, judged blind, in about ten seconds. Nothing is installed,
nothing in your repo is touched.

```
⏺ Update(src/components/DeleteButton.tsx)
  ⎿  Error: stet: this path is governed by a decision the human has not made yet.

     delete-confirm — "Modal or inline undo?"
     claims: src/components/**

     Do not implement either option yet — whichever you pick has a 50% chance of
     being thrown away. Either work somewhere else, or block on the verdict with:
       stet await delete-confirm
```

**Every other human-in-the-loop tool writes a sentence into a file and hopes.**
`CLAUDE.md`, `AGENTS.md`, memory, rules files — all of them are suggestions,
read once at the top of a session, competing with every token that arrives
after. An instruction can be ignored. A denied tool call cannot.

Built for Claude Code: six hooks, two slash commands. Zero runtime dependencies,
no account, no key, and nothing ever leaves your machine.

---

## Install

```bash
npm i -g stetmark     # then the command is just: stet
stet                  # run it in any repo — first run initialises and wires
```

Pin `@latest` on any `npx` form. `npx stetmark` will happily run whatever version
npm cached on that machine months ago, and a first run that fails because the
binary predates the command you typed is the worst possible introduction — it
happened to the first person who tried it. stet never talks to the network, so it
cannot tell you it is stale.

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

The agent runs one line — this is the whole call, there is nothing to author:

```bash
stet ask "Which hero?" --url localhost:5173/a --url localhost:5173/b --wait
```

```
agent hits a fork  →  stet ask "…" --wait      (blocks, burns nothing, no tokens)
                   →  you get a notification
                   →  you open a page and judge the real thing, running, side by side
                   →  one line becomes a rule
                   →  the rule is injected into AGENTS.md, CLAUDE.md, .cursorrules…
                   →  the agent unblocks with the verdict and continues
                   →  every future agent obeys it without asking
```

That matters more than it looks. An agent is trained to finish, so asking has
to cost less than guessing or it will never happen — and "stop, read a schema,
author fifteen lines of JSON, block" costs more. Four shapes cover almost
everything:

```bash
stet ask "Which empty state?" "Nothing here yet" "Start your first project"
stet ask "Which hero?"    --url localhost:5173/a --url localhost:5173/b
stet ask "Which spacing?" --image before.png --image after.png
stet ask "Which shape?"   --code a.ts --code b.ts
```

Add `--wait` to block until you rule. Add `--globs 'src/hero/**'` and writes
into those paths are **denied** until you do — so an agent with other work can
carry on and still cannot quietly ship the guess.

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

Taking those captures is one command, and it drives a browser the machine
already has — no dependency, nothing downloaded:

```bash
stet capture A=http://localhost:5173/?v=a B=http://localhost:5173/?v=b \
             --views desktop:1280x800,mobile:390x780 --json
```

It sets the viewport the page lays out against rather than asking for a window,
because a window request below the platform minimum is silently widened and the
page is then cropped — producing an image with the right dimensions and the
wrong content. Every shot is checked against the width the page actually saw.

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

stet is aimed at Claude Code specifically. It writes a vendor-neutral
`AGENTS.md` and syncs into other agents' surfaces, and that still works — but
every mechanism below is a Claude Code hook, and that is where the effort goes.
A tool that hedges across five agents ends up being a text file for all of them,
which is the exact thing this exists to replace.

```bash
stet claude          # wire it in     ·  stet claude remove  ·  stet claude status
```

`stet claude status` answers three questions, and the third is the one that
matters:

```
wired — .claude/settings.local.json
verified against stet 0.25.0 — all 6 events implemented

  PreToolUse        seconds ago
  PostToolUse       never called
  Stop              never called
  SessionStart      seconds ago
  PreCompact        never called
  UserPromptSubmit  never called
```

*Wired* is read from a settings file. *Verified* is asked of the binary those
hooks point at. Both are declarations. **Has Claude Code ever actually called
it** is the only empirical one — and stet wired a hook to a non-existent event
called `PostCompact` for its entire life, which satisfied the first two checks
and never fired once. If nothing has been called, hooks load at session start:
restart Claude Code.

That wires six hooks for the agent, and two slash commands for you — so the
loop is driven from inside the session it interrupts:

```
/stet         what is waiting on you, and what the canon already says
/stet-undo    take back a verdict, and the rule it earned
```

Both are removed by `stet claude remove`, and neither will overwrite a command
of the same name that you wrote yourself.

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

**The instruction that starts the loop arrives through the hook, not a file.**
`SessionStart` delivers how to ask — and how to record a note — before any work
begins, even in a repo with an empty canon, because day one is exactly when an
agent needs to know it can ask. stet still writes a vendor-neutral `AGENTS.md`
for other tools, but Claude Code's documented memory file is `CLAUDE.md`, and
stet only writes that one if it already exists. Sending the thing that causes
everything else down a channel whose loading was never verified was the last
place this tool trusted a declaration over evidence.

**A verdict binds the session that asked for it.** `SessionStart` states the
canon once at the top. But a rule you earn *mid-session* — the one the agent is
sitting there waiting for — has already missed that, and an unscoped rule never
travels through `PreToolUse`. `UserPromptSubmit` delivers it at the next thing
you type, once, so the answer you just gave governs the work in front of you
rather than the work tomorrow.

**Taste survives compaction.** `PreCompact` re-states the canon and forgets what
the doomed context was told, so the next thing you type restates it into the
fresh one — because compaction is exactly when your preferences get summarised
away.

**And it notices what you never wrote down.** The gate only helps once a
decision exists — but nothing creates one, because an agent trained to finish
does not stop to ask. So stet watches for the same signal from the other side:
`PostToolUse` records *which instruction* caused each write, and when one file
has been revised across three separate instructions, `Stop` says so:

```
stet: unwritten taste detected.

  src/hero.tsx — revised across 3 separate instructions this session:
    · "make the button label say what actually happens"
    · "shorter — Buy now, not Purchase this item"
    · "and keep it lowercase like the rest of the app"

  stet rule "<the one line>" --globs 'src/**'
```

Three edits inside one instruction is an agent working. Three edits across
three instructions is a human correcting — and a correction repeated is a
preference nobody has recorded. It quotes what you actually said, because a
count says a file was argued over and the words say what the argument was
about — the third line there is visibly taste rather than a bug. `stet churn`
shows the standing tally. This is a hypothesis about a signal, not a proven
one; the threshold is `--threshold`.

Those prompts are kept one line each, capped, in `.stet/sessions/` — which
`stet init` git-ignores and stet sweeps after a day.

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
> not be gated.

`stet claude status` does not just check that the wiring exists — it runs the
binary the hooks actually call and asks which events it implements:

```
wired — .claude/settings.local.json
verified against stet 0.5.0 — all 5 events implemented
```

That check exists because the failure it catches is invisible. The wiring is
written by whichever stet you ran; the hooks call whichever stet is on `PATH`,
and `npm publish` does not update your own machine. An older binary handles the
events it knows and returns nothing for the rest — so the hooks fire, gate
nothing, and every surface reports a healthy install. It bit this project four
times before it was made to check itself.

## Three doors into the canon

- **Blind A/B** — the highest-quality judgment, because you can't cheat it.
- **Accept / reject one artifact** — an item with a single variant is a
  "good enough to ship?" gate.
- **A correction, typed straight in** — `stet rule "never centre the hero"`,
  for when you've already corrected an agent twice. Add
  `--globs src/web/**` and it becomes a scoped rule: delivered as a system
  reminder at the moment an agent writes a matching file, rather than sitting
  in AGENTS.md hoping to be remembered.

All three land in `.stet/RULES.md`, which is the actual product: your
accumulated taste, in plain text, portable, and enforceable by any agent.

And all three can be taken back. A rule starts governing every agent the moment
it lands, so a wrong one is expensive:

```bash
stet undo              # take back the last verdict, and the rule it earned
stet undo hero-type    # or a particular one — it goes back in the queue
stet rule remove 4     # delete a rule outright; the others keep their numbers
```

## Notes: what the codebase taught

The canon holds verdicts — things a human decided. There is another kind of
knowledge a repository accumulates, and stet had nowhere to put it:

> `weakness()` exists twice; the page has its own copy and no imports.
> `absorbAsset` covers `image` and `audio` only.
> `Number(v) || undefined` eats a legitimate `0`.
> Globs are relative to the project root, not to where you're standing.

Those aren't preferences. Nobody chose them. They're **landmines** — invisible
from the code, expensive to learn, and cheap to state once known.

```bash
stet note "the second copy of weakness() is here; rules.ts has the other" --globs 'src/page.ts'
```

Delivered exactly like a scoped rule — as a system reminder, at the moment
somebody edits that file, once per session:

```
stet rules that govern src/page.ts — binding, already decided by this repo's owner:
1. never centre the hero

stet notes for src/page.ts — learned here, not obvious from the code:
· the second copy of weakness() is here; rules.ts has the other
· no backticks inside the PAGE template literal — it breaks the build
```

|  | **rules** | **notes** |
|---|---|---|
| what it is | a preference | a fact |
| who writes it | **only a human**, after a verdict | **an agent**, the moment it learns one |
| force | binding | informational |

That second row is the point. An agent cannot decide taste — that is the whole
premise of this tool. But an agent is the best possible author of *"here is what
just cost me an hour"*, and a note is the half it can legitimately write.

Rules are always selected first and against the full budget; notes take what is
left, capped at four. If the two ever compete for room, the binding one wins.
Scope is required — a note with nowhere to arrive is a document, and documents
are exactly what this replaces.

**Why this exists:** three of the 45 bugs in stet's own build log are bugs that
had already been fixed *and written up* before being written again — a
lazy-loaded element inside a collapsed box, a listener attached after the event
it waits for, and identity inferred from content that varies. The write-up
existed every time. It was in a document, and a document is never delivered at
the moment of the edit. This repo now ships its own
[`.stet/NOTES.md`](.stet/NOTES.md).

## The method canon

Taste is not the only thing that fails to compound. Method does too — and an
agent starts every session without any of it.

```bash
stet method          # or: stet method --list, to read them first
```

Eight rules, each one earned from a specific recorded failure in stet's own
build log, and each carrying that failure in the canon so you can check the
reasoning rather than take it:

```
reproduce a reported failure before changing anything, and say plainly when it does not reproduce
a green signal is not evidence — look at the artifact a person would actually touch
test the artifact you ship, not the tree you built it in            → package.json, .github/workflows/**
verify against the other side's list, never against your own names
keep the reproduction as a permanent check, not only the fix        → test/**, **/*.test.*
a warning that fires on correct input trains people to ignore warnings
never infer identity from content that varies — write an explicit marker
when the same logic lives in two places, change both and add a check that they agree
```

Two of them are scoped, so they arrive as a system reminder at the moment an
agent writes a test or touches the release config — not as advice at the top of
a session that is gone by turn sixty.

This is not a style guide. **Thirty-six of the forty-four bugs found in building
stet reported success while broken**, and every rule above is the one that would
have caught a specific one of them. It is never installed unless you ask: a
canon is a claim about what your repository believes, and filling it with claims
you never made is the thing this tool refuses to do everywhere else. Remove any
of them with `stet rule remove <n>`.

## Does it actually work? Check for yourself

stet was built under its own gate, and every failure found along the way is
written down as it happened — including the ones that were embarrassing, the two
that were reported and turned out not to reproduce, and the one that was fixed
and then reintroduced by the person who fixed it.

**[`showcase/JOURNAL.md`](showcase/JOURNAL.md) — 45 bugs found by using the
tool, not by reading the code.**

The number that matters is not 45. It is this:

| | |
|---|---|
| Bugs found by running it | **45** |
| Bugs that announced themselves — a crash, a hang, a non-zero exit | **8** |
| Bugs that **reported success while broken** | **37** |

That is the shape of the problem an agent has, and it is not solved by being
careful. A capture with the right dimensions and the wrong picture. Two live
previews that rendered blank. A hook wired to an event Claude Code does not
emit, which never fired once and passed a green status check for the life of the
project. A published package that identified itself as the previous version.
Every one of those was invisible from the code and obvious the moment somebody
looked at the artifact.

Eight of those lessons are installable as rules — see [the method
canon](#the-method-canon).

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

stet capture A=<url> B=<url>  matched screenshots of every variant at every view
stet schema                 the item format, as a worked example
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

## Many agents at once

Fan-out workflows, parallel subagents and two terminals on one repo all write to
the same canon, so every mutation of `RULES.md` is serialised with a lock file —
`open(path, 'wx')`, which fails atomically if the path exists. Held across the
read-modify-write, released in a `finally`, taken over after twenty seconds if
the holder died.

Measured on 20 agents recording a rule at the same instant:

| | before | after |
|---|---|---|
| rules that survived | 16 / 20 | **20 / 20** |
| distinct rule numbers | 10 | **20** |
| duplicate numbers | 4 | **0** |

Decision ids are claimed by `mkdir` itself rather than by asking whether the
directory exists, so two agents queueing the same id cannot both win. Every
write into a shared surface goes through a temp file and a rename, so a reader
sees the old canon or the new one and never half of one.

**The gate never locks.** The hook path only reads, so `PreToolUse` stays at
50ms no matter how many agents are writing.

`await` was tested in the same shape — eight agents blocked on verdicts while
eight more wrote rules, verdicts landing in reverse order. All sixteen
succeeded, no rule lost, no rule number duplicated, `AGENTS.md` whole. Twelve
agents blocked at once measured **0% CPU in total**.

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
