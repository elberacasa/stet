# Working on stet

stet is developed under its own gate. That is the point of it, and it is also
the source of the one setup mistake that will cost you an afternoon.

## The mistake to get out of the way first

**`stet` on your PATH is not necessarily the stet you are editing.**

A global `npm i -g stetmark` pins whatever version was current that day. It then
answers `stet claude`, `stet status` and every hook — from a build that may
predate the command you just wrote. This happened here: the global install sat
at **0.4.0 for twenty-one releases** while the working tree moved on, and every
`stet claude` run in this repo silently fell back to pinning an absolute path
because it correctly detected that the `stet` on PATH was too old.

Link the working tree instead, once:

```bash
npm link          # now `stet` anywhere on this machine is this checkout
stet --version    # must match package.json
```

`npm run build` after changing `src/`. The linked binary runs `dist/`, not
`src/`, so an unbuilt change is invisible — which looks exactly like your change
not working.

To go back to a published build: `npm unlink -g stetmark && npm i -g stetmark`.

## Layout

```
src/              the tool. zero runtime dependencies, and that is a hard rule
  cli.ts          every command; hand-rolled arg parsing
  hooks.ts        the six Claude Code hooks — the hot path, runs per tool call
  claude.ts       wiring, slash commands, and the list of events Claude Code emits
  rules.ts        the canon: a human's verdicts, binding
  notes.ts        what the codebase taught: facts, agent-writable, informational
  page.ts         the decision screen, as one self-contained HTML string
  store.ts        everything on disk under .stet/
test/             vitest, plus four .mjs stress suites that run before publish
fixtures/         seven real decisions — these ship, and `stet demo` runs on them
showcase/         the build journal and the landing page
docs/stet.gif     the README hero
```

## The rules that are not negotiable

**Zero runtime dependencies.** Node built-ins only. The browser control speaks
DevTools Protocol over Node's own WebSocket; the tokenizer is an estimate rather
than a package.

**A hook must never break a session.** Any failure exits 0 with no output, which
Claude Code reads as "carry on". It must also stay fast: it runs on every tool
call, in every parallel agent.

**No backticks inside the `PAGE` template literal** in `src/page.ts`. They
terminate the string and break the build. This has happened twice.

**Never wire an event that is not in `CLAUDE_EVENTS`.** A hook wired to an event
Claude Code does not emit never fires and reports perfectly healthy. That is
what `PostCompact` did for the life of the project.

More of these are delivered to you as you work — see below.

## This repo is under its own gate

```bash
stet claude status
```

Six hooks and two slash commands are wired locally. While you work here you will
get the canon at session start, scoped rules at the moment you write a matching
file, and `.stet/NOTES.md` — the landmines this codebase has already taught
somebody — delivered when you touch the file they are about.

If `status` says nothing has ever been called, hooks load at session start:
restart Claude Code.

`.stet/RULES.md`, `.stet/NOTES.md` and `.stet/decided/` are committed — the
canon, the landmines, and the decisions they were earned from.
`.stet/sessions/` is not: it is per-developer state, and
`.claude/settings.local.json` is machine-specific because the wiring may pin an
absolute path.

## Before you push

```bash
npm run build && npm test        # the unit suite
npm run stress                   # four suites, including one that packs the
                                 # tarball and installs it somewhere clean
```

`npm run prepublishOnly` runs all of it. Do not skip the stress suites: five
bugs shipped in 0.16 that every unit test passed, because every unit test ran
against `src/` and nobody had installed the tarball.

**Tests must not touch the repository they run from.** Spawned hooks need an
explicit `cwd` — a payload with no `cwd` falls back to the project containing
the process, which is your checkout. `test/stress.mjs` asserts this.

## The method

Everything in [`showcase/JOURNAL.md`](showcase/JOURNAL.md) is a failure found by
using the tool, written down as it happened. The running tally at the bottom is
the summary; the great majority of them reported success while broken. It is
long, and it is the most useful thing in the repository.

Counts go stale, so this file does not carry them — that is the same defect as
a hook wired to an event that does not exist, only in prose.

The eight rules distilled from it are installable — `stet method` — and are
already in this repo's canon.
