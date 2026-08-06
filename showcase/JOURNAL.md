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

## The capture rig, and the bug it had for ten minutes

`stet capture A=<url> B=<url>` now exists: every variant at every view, one
command. Zero dependencies still holds — it drives a Chrome the machine already
has, and when there is none it prints the rig it would have run so an agent with
its own browser tools can do it by hand.

The first version asked for a window: `--window-size=320,740`. All four shots
reported success.

### Finding 7 — a capture that is the right size and the wrong picture

The 320px capture was cropped, not reflowed. The platform is entitled to refuse
a window that small, so Chrome laid the page out at its minimum width and cut
the image down to the size that was asked for. The result had exactly the
requested dimensions and showed a desktop layout with the right-hand third
missing — the header nav sliced mid-word.

It was only visible because the image was **looked at**. Every automated signal
said fine: process exited 0, file written, PNG header 320x740.

The fix is to stop asking for a window and set the viewport the page actually
lays out against, through `Emulation.setDeviceMetricsOverride`. Node ships a
WebSocket client, so speaking DevTools Protocol costs no dependency:

```
  asked  1280 → page laid out at 1280 ✓
  asked   390 → page laid out at 390 ✓
  asked   320 → page laid out at 320 ✓
  asked   280 → page laid out at 280 ✓
```

And because that failure is invisible by construction, `capture` now measures
`innerWidth` after every shot and says so when it does not match:

```
  ✗ live-narrow  320x740  55KB  laid out at 500px, not 320
```

A capture rig that silently crops is worse than none: it would have produced a
matched pair that looked authoritative and was a lie, and a verdict given on it
would have entered the canon as fact.

---

## The landing page, built with the tool it advertises

Rebuilt taking the devices from Umbra's page — `> SECTION_` labels, floating
cards, a real terminal, SVG figures with flowing dashes, a big-number strip —
in stet's own dark palette, with a serif for the headlines so it does not read
as another mono dev-tool page. The system serif stack, not a webfont: a page
whose pitch is "no network" should not fetch one.

Every figure on it is a number this project actually measured. The one curve
that is not measured says so in its own caption.

`stet capture` then checked its own advertisement at four widths, and the
verification earned its place twice in ten minutes.

### Finding 8 — the emulation was realistic and therefore wrong

The first pass reported `laid out at 476px, not 390`. Capture was setting
`mobile: true`, which is realistic — and realistic means Chrome shrink-to-fits
when content overflows, so the page laid out at 476 and the capture was not
"this page at 390px" at all.

A matched view has to mean exactly the width it claims, so emulation is now
`mobile: false`. `innerWidth` is then always the requested width, and overflow
shows up as overflow rather than being silently zoomed away. Realistic was the
wrong goal; comparable was the right one.

### Finding 9 — the nav overflowed, and the page said so before I looked

With the viewport honest, `innerWidth` was 390 while the document was 475. The
offender was the nav: brand, four links and a pill do not fit in 390px. Hidden
below 820px, along with a set of small-screen adjustments — found by the tool
the page is advertising, before the page was ever published.

### Finding 10 — cleanup that failed after everything succeeded

`Chrome.close()` removed the temp profile immediately after `SIGKILL`, which
races Chrome still writing to it: `ENOTEMPTY`, thrown at the very end, failing
a capture in which every single shot had already worked. It now waits for the
process to actually exit, retries, and treats a stray temp directory as not
worth failing over.

### Finding 11 — SVG text cannot wrap, so every box overflowed

The loop diagram was hand-positioned SVG: five `<rect>` boxes with `<text>`
inside them at fixed coordinates. SVG text has no line box, so the moment a
label ran longer than its rectangle it simply carried on past the border —
"a different agent obeys" ran out of its own box, and the return-arc caption
sat directly on top of the arc it was labelling.

Rebuilt in HTML. Boxes that hold text should be boxes: a five-column grid
wraps automatically, the connectors are `::after` pseudo-elements between
cards rather than coordinates, and the caption sits on a background-coloured
chip so it masks the line instead of colliding with it. Below 1000px it folds
to two columns and drops the connectors.

The general lesson, which cost this project twice: **use SVG for the shapes
and HTML for the words.** The decay curve and the token bars stay SVG — they
are geometry with short labels, which is what SVG text is for.

### The hero example

Swapped from an API-shape question to something anyone building an app has
hit: *"Should deleting ask first, or just be undoable?"* — and rendered in
Claude Code's actual tool-call format, `⏺ Update(...)` above `⎿ Error:`,
rather than an invented one. The point of the hero is recognition, and a
developer-only example asks the reader to translate before they can react.

### Rewriting the page around the product, not the mechanism

Read back cold, the page explained hooks, token counts and a decay curve, and
never once showed the thing you actually do. It read as agent memory with extra
steps — because the product was not on its own landing page, and the difference
from memory was never stated.

Two sections were added and the hero was re-pointed:

- **The product, first.** A recording of the real decision screen sits directly
  under the hero: two versions of a landing page in one frame, the flip, the
  verdict, the reveal, the rule entering the canon. Above it, three panels in
  the reader's own language — *"Make the buttons rounder." It rounds the buttons
  and restyles the nav.*
- **This is not agent memory.** A six-row comparison, which is the honest way to
  answer the objection rather than avoid it. Memory infers a preference from a
  conversation and offers it back; a canon records a judgment made while looking
  at the work, with labels hidden, and then enforces it. The page says outright
  that both can be true at once.
- The hero no longer ends on the refusal. It says what happens ten seconds later.

### Finding 12 — the canon showed the rule you had just replaced

Recording the new GIF surfaced it. Sharpening a rule at the reveal changes
neither the pending list nor the rule count, and the page's re-render signature
was `[pending ids, rule count]` — so the canon screen kept rendering the
unsharpened line while the disk, `AGENTS.md` and the API all had the new one.

The signature now covers rule text. Worth noting how it was caught: not by a
test, but by screenshotting the canon for a promotional GIF and reading it.

---

## Bulletproofing for many agents at once

A fan-out workflow, parallel subagents, two terminals on one repo — all of them
write to the same canon. That path had never been tested, so it was tested
before it was defended:

```
20 agents recording a rule at the same instant
  rules that survived : 16 / 20
  distinct numbers    : 10
  duplicate numbers   : ## 1, ## 2, ## 8, ## 9
```

### Finding 13 — the canon lost updates and duplicated rule numbers

Every path that touches `RULES.md` is read-modify-write: append reads the file
to find the next number, revise rewrites one heading, `bumpHits` rewrites
provenance lines. Concurrently, they read the same maximum and both claim it —
four rules vanished, and rule numbers collided, which also breaks `reviseRule`,
since it targets a rule *by number*.

`open(path, 'wx')` fails if the path exists, and that check-and-create is atomic
at the filesystem. That is the whole mechanism: a lock file next to `RULES.md`,
held across the read-modify-write, released in a `finally` so a throwing write
cannot wedge every later one. A lock older than twenty seconds is assumed to
belong to a process that died and is taken over — verified by planting one and
watching the next writer recover in 56ms. Waiters back off with jitter so they
do not synchronise, and a live lock times out with a sentence rather than
hanging.

After:

```
rules that survived : 20 / 20      duplicate numbers : 0
distinct numbers    : 20           leftover locks    : 0
```

Two smaller races went with it. Claiming a decision id used `existsSync` then
`mkdir`, so two agents queueing the same id both passed the check and the loser
silently overwrote the winner; the id is now claimed by `mkdir` itself, which
fails atomically. And every write into a shared surface — `AGENTS.md`,
`CLAUDE.md`, `.claude/settings.json` — now goes through a temp file and a
rename, so an agent reading mid-write sees the old canon or the new one, never
half of one.

**The gate path does not lock.** `hooks.ts` only ever reads, so `PreToolUse`
stays at 50ms whatever else is happening. Locking a hook that fires on every
tool call would have traded a rare corruption for a constant tax.

---

## Stress testing the server and the page

The store, the hooks and concurrency had all been attacked. The interface never
had — it had only ever been driven gently, by me, one decision at a time. Eight
scenarios, run against the real server:

```
1. two tabs commit the same decision at once   ✓ 200 and 400, one rule written
2. hostile item content reaching the page      ✓ 0 scripts executed
3. an unparseable item                         ✓ surfaced, not skipped
4. 25 browser tabs listening at once           ✓ state still answers in 1ms
5. a fan-out queueing 40 decisions             ✓ 2ms for 42 pending
6. the blind guarantee under all of it         ✓ 42 pending, no map leaked
7. ten malformed requests                      ✓ no 500, server alive
8. a decision landing mid-commit               ✓ exactly one rule added
```

The interesting result is that seven of these passed first time. The store was
already careful, and the two-tab race is defended by the same thing that makes
the gate work: `decide` renames the item directory, and a rename either happens
or does not.

### Finding 14 — one of the passes was luck

`item.json` is authored by an agent, so a prompt-injected agent could put
`javascript:` in a `url` block, or `<script>` in a question. Loaded in a real
browser with payloads in every field — question, notes, how, tags, titles, code,
diff paths, image src, url href — **nothing executed**. Everything rendered as
visible text.

But the `javascript:` href passed for the wrong reason. `asset()` tests for
`https?:`, `data:` and `/`, and a scheme it does not recognise falls through to
the relative-path branch, so `javascript:alert(1)` became
`/a/hostile/javascript%3Aalert(1)`. Defused by accident. That stops being true
the instant somebody widens that check for a good reason.

Schemes are now refused deliberately: `http`, `https`, protocol-relative and
repo-relative paths are allowed; `data:image/*` is allowed for images only;
everything else is refused and **shown as text**, so a human sees what was
attempted rather than the tool quietly dropping it.

### And the honest indicator, verified honestly

Killed the server with the page open: it says **server gone**. Restarted it:
the page reconnected by itself and went back to **live**, still rendered, still
zero scripts executed. That claim had been in the README since v0.1 and had
never once been tested.

---

## `await` under multi-agent load

The claim being tested: a fleet of agents can block on verdicts, burn nothing,
and each wake with its own answer. Six scenarios, and a seventh built to hunt
one specific race.

```
12 agents, verdicts landing as they boot   ✓ 12/12, slowest 115ms
a verdict that already happened            ✓ returns in 47ms, no event needed
6 agents blocked on one decision           ✓ all six wake
12 blocked at once                         ✓ 0% CPU total
an agent nobody answers                    ✓ exits 1 at 2065ms for a 2s timeout
8 waiters + 8 writers, verdicts reversed   ✓ 16/16, 0 duplicate rule numbers
```

The fan-out case is the one that matters for a workflow: eight agents blocked
on verdicts while eight more wrote rules into the same canon, with the verdicts
landing in reverse order. Every waiter woke with its own answer, every writer
succeeded, no rule was lost, no rule number collided, and `AGENTS.md` came out
whole.

### A race I could not reproduce, and closed anyway

`await` checks whether the decision is already made, then installs a file
watcher. A verdict landing *between* those two steps fires no event the watcher
can see, and the agent would block until its timeout for an answer that already
exists.

I tried to hit it: 140 trials sweeping the delay from 40ms to 316ms in 4ms
steps, which straddles the moment the child process boots and reaches its check.
121 trials found the verdict already decided; 19 were genuinely woken by the
watcher; **zero hung.** The boundary was approached from both sides many times
and never landed inside it — the window is sub-millisecond, and 4ms granularity
is not fine enough to hit it.

So: not reproduced, and reported as not reproduced. But the ordering is right
there in the code, and closing it costs one extra `stat` after the watcher is
installed. That is the cheapest possible insurance against an agent hanging for
a decision that has already been made, which is a failure a human would never
think to look for.

This is a different category from the other findings in this log. Everything
above was found by running the thing. This one was found by reading the order of
two lines, and the honest status is *theoretically open, practically unobserved,
now impossible.*

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
| 11 | looking at a capture | `--window-size` cropped instead of reflowing: right dimensions, wrong picture, every signal green |
| 12 | capturing the landing page | mobile emulation shrink-to-fit made a 390px view lay out at 476px |
| 13 | the same capture | the nav overflowed at 390px — caught by the tool the page advertises |
| 14 | the same capture | profile cleanup raced Chrome's exit and failed a capture after every shot succeeded |
| 15 | a screenshot of the page | SVG `<text>` cannot wrap, so every box in the loop diagram overflowed its own border |
| 16 | recording the demo GIF | the canon kept showing a rule after it was sharpened — the re-render signature tracked rule count, not rule text |
| 17 | 20 agents at once | read-modify-write on RULES.md lost 4 of 20 rules and produced duplicate rule numbers |
| 18 | 8 agents, one id | `existsSync` then `mkdir` let two agents claim the same decision; the loser overwrote the winner |
| 19 | injecting a hostile item | `javascript:` URLs were defused by accident, not on purpose — safe today, unsafe after any widening of the scheme check |

The pattern is consistent enough to be a rule: **the failures that matter are
invisible from the code and obvious from the use.** Eight of the ten reported
success while broken.

Finding 10 is the one worth dwelling on, because it was not found by a test or a
crash — it was found by looking at what two real verdicts actually produced. The
mechanism worked exactly as designed and the design was wrong.
