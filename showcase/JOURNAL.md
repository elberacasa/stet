# Building stet's landing page, with stet

A working log of a real project built under stet's own gate, kept as it
happened rather than tidied afterwards. Every bug below was found by running
the tool, not by reading the code. That is the point of the exercise.

The project: stet's landing page. Chosen because the repo actually needs one,
because a landing page is saturated with forks that have no right answer, and
because the loop closes on itself — the tool's site, decided under the tool's
own gate, with the verdicts committed in `showcase/.stet/`.

---

## Setup

```bash
mkdir showcase && cd showcase
stet init          # ← this command did not exist an hour ago
stet claude        # wire the gate
```

### Finding 1 — stet could not be started inside another stet project

The first command failed silently in the worst way. `stet sync` inside
`showcase/` walked up to the parent repository, found stet's own `.stet/`, and
operated on **that** — writing `AGENTS.md` and hooks into the parent while
reporting success. `showcase/` was left empty.

Every command resolves the project by walking up to the nearest ancestor
`.stet/`, which is right for a repo and wrong for a monorepo package, an example
folder, or any nested project. And nothing created one where you stood, so there
was no way out of it.

`stet init` now creates a project in the current directory regardless of
ancestors, and says plainly when it is shadowing one above:

```
  initialised .stet
  created   AGENTS.md

  note: .. is also a stet project.
  this directory now keeps its own canon; the one above no longer applies here.
```

---

## The first decision

Two hero treatments, written as real HTML rather than mockups, served on
`127.0.0.1:7900`, and captured at an identical 1200px viewport so the only
difference in the frame is the argument's order.

- **promise first** — headline states the claim, the refusal appears lower as evidence
- **proof first** — the actual deny message is the hero, the headline explains it

Queued with `stet ask`, which shuffled the labels on intake. Displayed A is the
one authored second; I do not know which is which on the page either.

### Finding 2 — matched capture is the weakest part of the workflow

stet tells agents to capture matched views and ships **nothing** to do it with.
In practice this took a dozen browser-automation calls, and two mechanisms
failed outright:

- `resize_window` reported success and did not change the captured viewport, so
  the mobile pair could not be taken that way.
- Rebuilding the page around a fixed-width iframe froze the renderer.

The desktop pair was captured cleanly and the mobile pair was abandoned in
favour of `url` blocks pointing at the live pages, which the human can resize by
hand. Honest outcome, but it exposes the real gap: **the capture rig is the
thing stet should ship next.** Vesper solved this with `stills.json` — a list of
fixed camera positions replayed for every variant. The web equivalent is a list
of URLs × breakpoints, and it should be one command.

### Finding 3 — asset filenames leaked the blind test

Assets were copied into the item directory under their original names, and the
page served them as `<img src="/a/hero-lead/a-desktop.jpg">`. The filename
survives into the DOM, where anyone can read it.

That is a hole straight through the product's core claim. An agent naming its
captures `stripe-shape.png` and `github-shape.png` — the obvious, helpful thing
to do — would hand the human the mapping the blind test exists to hide, visible
on hover.

Assets are now renamed on intake, **after** the shuffle, to `<label>-<n>.<ext>`:

```
before:  A → a-desktop.jpg    B → b-desktop.jpg     ← authoring order, leaked
after:   A → A-1.jpg          B → B-4.jpg           ← tells you nothing
```

---

## Running tally of bugs found by use, across the whole project

Not one of these was visible from reading the code.

| # | found by | what it was |
|---|---|---|
| 1 | wiring a repo | version skew: hooks wired by a newer stet, called by an older one — fired, returned nothing, gated nothing, reported healthy |
| 2 | writing tests | shared mutable default: every session read the same `edits` object by reference |
| 3 | stress test | ReDoS in glob matching — 8× per nested `**`, minutes at ten, inside a hook on every write |
| 4 | stress test | lost updates: 40 parallel `PostToolUse` hooks recorded 34 |
| 5 | stress harness | a hook whose stdin never closes waits forever |
| 6 | asking "can an agent drive this?" | `stet ask --help` hung; the item format was undocumented entirely |
| 7 | this showcase | no way to start a project inside another one |
| 8 | this showcase | asset filenames leaked the blind mapping into the DOM |

The pattern is consistent enough to be a rule: **the failures that matter are
invisible from the code and obvious from the use.** Six of the eight reported
success while broken.
