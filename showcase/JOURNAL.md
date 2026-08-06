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

## The first verdict

**A — proof first.** The blind test did its job: the winner was the variant
authored second, and the shuffle meant it was judged without that being visible
from either side.

`site/index.html` is built from it — the refusal is the hero, the explanation
comes after, and the measured claims are a table rather than adjectives.

### Finding 4 — the claimed glob matched nothing, and nothing said so

The item claimed `showcase/site/**`. But the project root **is** `showcase/`, so
a write to that file is seen as `site/variant-b.html`, and the glob never
matched. The item was accepted, listed as pending, rendered on the page — and
its gate was inert the whole time.

Globs are relative to the project root, which is not always where the author is
mentally standing. `stet ask` now checks at intake and says so:

```
stet: "showcase/site/**" matches nothing under /Users/…/stet/showcase
      this project is rooted at showcase/ — did you mean "site/**"?
      the decision is queued, but it will not gate any writes.
```

A warning rather than a rejection: claiming a path for a file you are about to
create is legitimate. Claiming one that cannot exist is not.

### Finding 5 — the sharpen step was not working, and the data said so first

Two verdicts, two rules, both unusable:

```
1. I think go with the flow
2. I like it, looks very clean and impactful to show an agent being stopped mid write
```

The weakness check flagged both. The warning was shown and clicked past both
times — which makes it a design failure, not a user failure. The sharpen field
pre-filled with the in-the-moment reason, focused and selected, so `Enter` kept
it. The weak path was the cheapest path.

Now, when the reason will not survive as a rule, the field starts **empty** with
a placeholder saying so, and the button reads **let it stand anyway** until
something usable is typed. It still never writes the rule for you — it just
stops making the bad outcome the default one.

### Finding 6 — my own scaffolding, worth recording

The variant server kept dying between captures. It wrote `200` and *then* read
the file, so a missing path threw after headers were sent, the catch wrote them
again, and `ERR_HTTP_HEADERS_SENT` killed the process. Not stet's bug, but it
cost three capture attempts and is the same shape as everything else here: it
reported success right up until it did not.

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
| 9 | this showcase | a glob relative to the wrong root matched nothing and gated nothing, silently |
| 10 | two real verdicts | the sharpen step made keeping a useless rule the cheapest action |

The pattern is consistent enough to be a rule: **the failures that matter are
invisible from the code and obvious from the use.** Eight of the ten reported
success while broken.

Finding 10 is the one worth dwelling on, because it was not found by a test or a
crash — it was found by looking at what two real verdicts actually produced. The
mechanism worked exactly as designed and the design was wrong.
