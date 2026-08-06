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

## The `url` block against a real dev server

Everything above tested stet against stet. The `url` block — the one that
embeds a running app side by side instead of a screenshot — had only ever been
pointed at static files stet served itself. That is not the case it exists for.
The case it exists for is a person with `npm run dev` already running.

So I wrote one: two variants of a pricing page on `127.0.0.1:5173`, behind
`?v=a` and `?v=b`. Not markup — a small app that does the three things a
screenshot cannot show and an iframe might quietly break. It writes to
`localStorage`, it `fetch`es its own `/api/price`, and it has a monthly/yearly
toggle that rewrites the prices. Each variant prints the result of all three
into the page, so a failure is legible from across the room.

Then a real stet item pointing both variants at it, and the page opened in a
browser.

### Finding 15 — both frames were blank white boxes

Same bug as the images, in a place I had not thought to look. An iframe with
`loading="lazy"` inside a container that has not been laid out yet is 0×0, and
a 0×0 element never enters the viewport, so it never loads, so it stays 0×0. It
waits for itself.

I had already fixed this for `<img>` and written down why. I then wrote the
`url` block and reached for the same attribute, because deferring work you might
not need is the reflex. The lesson did not transfer, because I had filed it as
*a fact about images* rather than *a fact about deferred loading inside
collapsed boxes*. It is now a test, phrased as the general fact.

### Finding 16 — the sandbox crippled every real app

Both frames rendered, and both printed:

```
localStorage:BLOCKED · fetch:FAILED
```

The sandbox was `allow-scripts allow-forms allow-popups`. Without
`allow-same-origin` a frame gets an **opaque origin**: storage throws, and
same-origin requests fail. Every real app — anything with a session, a theme
preference, a cart, an API call — is broken inside the preview. It renders. It
looks fine. It is not the app.

The reason `allow-same-origin` was missing is a real one, not an oversight: for
a frame served from stet's *own* origin, `allow-scripts allow-same-origin`
together let the frame reach its parent and remove its own sandbox — the
sandbox becomes decorative. So the fix cannot be to add the flag.

It is to decide from the origin:

```js
function sandboxFor(href){
  var base="allow-scripts allow-forms allow-popups";
  try{ if(new URL(href,location.href).origin!==location.origin) return base+" allow-same-origin"; }catch(e){}
  return base;
}
```

A dev server on another port is a different origin. It gets its own origin back
— which is all it ever wanted — and still cannot touch the page holding it. I
verified that second half rather than assuming it: from inside both frames, the
parent document reads `blocked`.

### Finding 17 — a CSS class worn by two different things

With the frames working I made them taller, since a real app does not fit a
16:10 box: `min-height:300px` and `resize:vertical` on `.live`.

The next screenshot had a 480×300 white rectangle sitting over the header.

The connection indicator is `<div class="conn live">`. The frame container was
`<div class="live">`. A bare `.live` rule had been matching both from the moment
I wrote the block; `aspect-ratio` on a small flex item did nothing visible, so
the collision sat there silently until a `min-height` made it 300px tall.

`elementFromPoint` on the rectangle named it in one call: `div.conn.live`,
`resize: vertical`, 480×300. The container is now `.liveframe`, and the test
asserts no bare `.live` rule exists.

### And then it worked

Both frames live, `localStorage:ok(1) · fetch:ok(USD)`, and clicking **Yearly**
in each changed `$12/mo` to `$120/yr` in one and `$40/mo` to `$400/yr` in the
other — two running apps, side by side, both interactive, and the human still
cannot see which is which.

Worth stating plainly what these three have in common: **the preview was
convincingly wrong.** It rendered, it was the right size, the frames were the
right URLs, and every automated check was green. What it showed was not the
app. Nothing but pointing it at a real dev server would have found that.

---

## Installing it the way a stranger would

Every check up to here ran against the working tree. Nobody installs a working
tree. So: `npm i stetmark@0.16.0` — the version published an hour earlier —
into a directory that had never seen stet, and then the first ten minutes of a
new user, in order.

It got three commands in.

### Finding 18 — the published 0.16.0 called itself 0.15.0

```
$ stet version
0.15.0
```

`VERSION` was a string literal in `src/cli.ts`, kept next to `package.json`
rather than read from it, and it had been left behind at the last bump.

That is an ordinary mistake with an unusual consequence here, because of what
that constant feeds. `stet hook events` reports it, and `stet claude status`
uses that report to decide whether the binary your hooks call is too old — the
check built specifically for **finding 1**, the bug that has come back four
times in this project. The safety net for version skew was itself reporting the
wrong version.

Now read from `package.json`, lazily, so the hook path never pays for it. One
source of truth, and a test at the release gate that compares them.

### Finding 19 — `--version` and `--help` created a project and hung

Both had `case` branches. Neither branch was reachable.

`parse()` sweeps anything starting with `--` into `flags`, so by the time the
switch runs, `args.cmd` is `''` — and `''` is the default command, which
initialises a project, writes `AGENTS.md`, and starts a web server that does
not exit. Typing `stet --help` in your home directory created `~/.stet/` and
`~/AGENTS.md` and then sat there.

The two things a person types first, before they have read anything.

They are consumed as commands now, before anything reads `args.cmd`.

### Finding 20 — every command silently ignored flags it did not read

`stet rule "buttons say what happens" --globs 'src/components/**'` printed:

```
  1  buttons say what happens
  in every agent surface in this repo
```

Nothing read `--globs`. The rule was written repo-wide, the scoping was
dropped, and the output reported success. Worse than the dropped flag was what
it meant: a **scoped** rule is the one delivered at the moment of a matching
write. An unscoped one lives in AGENTS.md. So the fastest way to record a rule
was also the only way that could not use the mechanism this whole tool is
about — and it did not say so.

`appendDirectRule` had accepted `globs` all along. The CLI just never passed
them.

The general form of the bug is worth more than the specific one: an unknown
flag was accepted and dropped everywhere, so every typo — `--glob`, `--view`,
`--tags` — silently changed what the command did. Each command now declares
what it reads, and anything else is refused by name:

```
$ stet rule x --glob 'src/**'
stet: rule does not take --glob — did you mean --globs?
       it takes: --tag, --globs
```

Which immediately caught a bug in the fix itself: normalising `--version` into
the `version` command left `version` sitting in `flags`, so the guard rejected
`stet --version` for passing a flag that `stet version` does not accept. The
test written for finding 19 failed on the fix for finding 20, before either
shipped.

### Finding 21 — the wiring detected the broken gate and wrote it anyway

`stet claude` wires the command `stet`, if `stet` is on PATH. On this machine
that resolves to an older global install, and `stet claude status` said so,
correctly:

```
! the stet these hooks call is too old to say what it supports.
  it fires, returns nothing, and gates nothing. fix: npm i -g stetmark@latest
```

The diagnostic was right. The behaviour around it was not. It detected that the
gate it had just installed does nothing, wrote it anyway, and told the user to
go install something globally — which is the wrong advice for someone who
installed locally on purpose, and leaves the repo claiming a protection it is
not providing until they act on it.

For local wiring it now probes first and pins the binary you actually ran when
the one on PATH cannot do the job. Same command, different outcome:

```
verified against stet 0.17.0 — all 5 events implemented
```

The four recurrences of finding 1 were all the same shape: *detect the skew,
report it, proceed anyway.* This is the first fix that removes the skew instead
of describing it.

### Finding 22 — the agent-facing contract had no contract

Items are authored by agents. Malformed input is the normal case. It was
unvalidated:

| what an agent sent | what happened |
|---|---|
| no `map` | `Cannot read properties of undefined (reading 'A')` |
| no `variants` | `Cannot read properties of undefined (reading 'map')` |
| no `question` | **queued successfully** — a decision screen with no question |
| `{"kind":"video"}` | **queued successfully** — a variant that renders as nothing |

The crashes are bad. The silent acceptances are worse: they produce a decision
the human is asked to make and cannot, with every signal green.

There is now a validator that reports every problem at once — an agent with
five things wrong should learn about five, not discover them one command at a
time — phrased for whatever wrote the item:

```
$ echo '{}' | stet ask
stet: this item cannot be queued:
       · "id" is required — a short slug like "hero-type"; it becomes the directory name
       · "question" is required — the one line the human reads before choosing
       · "variants" is required — an array of what the human is choosing between
       run `stet schema` for a worked example
```

### The mistake I nearly shipped inside the fix

My first version required at least two variants, on the reasoning that a
decision with one option is not a decision.

The README documents a single-variant item as a supported mode: the "good
enough to ship?" gate, where the verdict is accept or reject rather than A or
B. I would have deleted a documented feature while adding a check meant to
protect the contract — and every test would have passed, because I would have
written the tests to match my assumption.

Reading the documentation caught it, not running the code. Zero is now the only
rejected count, and there is a test asserting the accept/reject gate survives.

### What the release gate tests now

Everything above was invisible to 94 passing tests and three stress suites,
because all of them ran against the source tree. The suite that would have
caught all five is the one that did: pack the tarball, install it somewhere
that has never seen stet, and walk the whole first-run path — first command,
init, wire, gate an edit, queue a decision, block an agent, decide, release it.

It is `test/stress-newuser.mjs`, and it runs before every publish.

---

## The question nobody had asked: does an agent ever call this?

Everything so far assumed the loop starts. Sixteen commits of gate, canon,
capture, live preview, concurrency and packaging — all downstream of a single
event that had never been examined: **an agent deciding to ask.**

So I read the only thing that causes it. The whole activation surface, in a
fresh project, was 373 bytes:

```
STET RULES — verdicts this repo's owner already gave. They are binding.
Follow them without asking again. Hitting a preference fork with no rule
here is the one time to stop and ask — run `stet schema` to see how.
```

Read that as the agent. You are mid-task. You are told to stop at "a preference
fork" — no definition you can act on — and then to *run a discovery command*,
read a schema, author fifteen lines of JSON with a `map` and `variants` and
`blocks`, and block.

You will not do that. You will pick one and keep going, because you are trained
to finish.

This project's own README says so, about the deny: *"An instruction can be
ignored. A denied tool call cannot. This is the only reliable way to stop an
agent that is trained to finish."* The ask was the one path in the entire tool
still resting on an instruction — the weakest mechanism — described in the
vaguest available terms, and gated behind a documentation lookup.

The fix is not a better instruction. It is making the ask cost less than the
guess.

### One line, nothing to author

```bash
stet ask "Which empty state?" "Nothing here yet" "Start a project" --wait
stet ask "Which hero?" --url localhost:5173/a --url localhost:5173/b --wait
stet ask "Which spacing?" --image before.png --image after.png
stet ask "Which shape?" --code a.ts --code b.ts
```

No `id` — it is slugged from the question, and collisions get a suffix. No
`map` — it is derived from the option itself, which is the honest answer to
"which one was that", overridable with `--why`. No JSON.

`--wait` queues and blocks in the same command, because an agent that asks and
then forgets to wait has guessed anyway. `--globs 'src/hero/**'` claims the
paths so writes there are denied meanwhile. The whole loop, one line:

```bash
stet ask "Which pricing page?" --url 127.0.0.1:5173/?v=a --url 127.0.0.1:5173/?v=b \
         --globs 'src/pricing/**' --wait
```

Two running apps, side by side, blind, from one command — and the agent held at
the gate until a human has ruled.

The long form still exists and still takes everything the flags cannot say:
matched views, mixed block kinds, notes. It is no longer the price of entry.

### Finding 23 — the page printed the answer under both panels

The `url` block rendered its address beneath every frame. With the shorthand
making URLs the easy path, that became the likeliest way to run a blind test —
and `/hero-serif` sitting beside `/hero-sans` tells the human exactly which is
which while they are still supposed to be judging the frame.

The address is withheld until the verdict now. The link still opens; it just
does not announce where it goes.

### Finding 24 — `localhost:5173` is not a host

`--url localhost:5173/a` produced a variant pointing at `localhost:5173/a`,
unmodified, while `--url 127.0.0.1:5173/b` correctly became
`http://127.0.0.1:5173/b`.

`localhost:5173/a` **is** a valid URL: scheme `localhost`, path `5173/a`. My
scheme check matched it and returned early. This is the same ambiguity a browser
address bar has, and the resolution is the same one browsers use: a colon
followed by a digit is a port, not a scheme.

Found by a test I wrote expecting it to pass.

### Finding 25 — `--port 0` was silently the default port

`Number(v) || undefined` reads `0` as unset. But `--port 0` is a real request —
let the operating system pick a free port — and swallowing it sent every caller
back to 7838, where they raced each other.

I only found this because I reached for `--port 0` to fix a flaky harness, and
the harness stayed flaky.

While fixing it: `stet --port notaport` used to initialise the project, write
`AGENTS.md`, sync every agent surface, *and then* report the bad flag. The
failure arrived after the side effects it should have prevented. Values are
checked before anything runs now.

### Finding 26 — my own test harness had the bug stet had

`stet ask --wait` exited correctly. The harness hung forever waiting for it.

```js
await fetch(`${base}/api/decide`, {…});                  // the child exits here
const code = await new Promise((r) => asking.on('close', r));  // listener attached after
```

`close` fires once. A listener attached after it fired waits for an event that
has already happened.

That is exactly the check-then-watch race I closed inside `stet await` two
releases ago — and I reproduced it, in the suite that guards the release, while
testing the fix for something else. It was intermittent: in section 6 the child
took 744ms to notice the verdict, longer than the fetch, so the listener won the
race. In section 7 it did not.

A flaky hang in a release gate is worse than a failing one. Both listeners are
attached at spawn now.

---

## The first sixty seconds

The loop works, the artifact is verified, and asking now costs one line. None of
that helps the person who runs `npx stetmark` in a repo, reads **nothing
pending**, and closes the tab. Everything stet does is visual, and seeing any of
it required already having an agent wired *and* a decision queued.

There were already seven worked examples in `fixtures/` — two live signup flows,
matched hero screenshots, an empty state, error copy, an audio pair, an API
envelope, a retry diff. They were used for testing and shipped to nobody.

`stet demo` copies them into a temporary directory and serves them. Through the
real intake, not a shortcut: labels shuffled, assets renamed after the shuffle,
map withheld. A demo that is not blind is not the product. Nothing is written to
the repo you are standing in, and no verdict there binds anything.

### Finding 27 — the one block kind that could not carry a file

`signup-live` is the decision that matters most in that set, because it is the
one nothing else can do: two running pages, side by side, click through both.

Both frames rendered as blank white boxes, and `/a/signup-live/variant-a.html`
returned **404**.

Local files are copied into the decision's own directory on intake and renamed
after the label they were shuffled into. That is finding 8's fix, and it covers
`image` and `audio`:

```ts
if (block.kind !== 'image' && block.kind !== 'audio') return block;
```

`url` was never added. So a `url` block pointing at a relative path was neither
copied — the file was not there to serve, hence the blank frame — nor renamed,
which means a real user's `hero-serif.html` beside `hero-sans.html` would sit in
the DOM announcing which variant was which. Broken and leaking, in the kind the
one-line ask reaches for first.

### Finding 28 — a source file that was binary to every search tool

While tracing how pending items are ordered I ran `grep -n "listEntries"
src/store.ts` and got nothing. The file is 11KB of TypeScript and the function
is in it.

`rg` explained it: *binary file matches (found "\0" byte around offset 4594)*.

The sort key separates a timestamp from an id with a NUL, and it had been
written as a **raw byte** rather than the escape `\u0000`. Both compile to the
same thing. But one of them makes grep, ripgrep, diff and GitHub's code viewer
treat the entire file as binary and return nothing for every search in it —
silently, which is how it survived this long. `store.ts` is the file with the
blind guarantee in it.

Now an escape, and a test asserts no source file contains a raw NUL.

### Two things I was wrong about, and checked

The demo opened on the API-envelope decision, because pending items sort by
`created` and seven queued in the same millisecond fall back to sorting by id.
Alphabetically that is `api-shape` — the least representative thing here — as
the first thing a newcomer sees. They are stamped a minute apart now, opening on
the live pair.

And when the live frames looked blank in a screenshot, I nearly logged a second
bug. The content is centred in a 500px frame and I had only looked at the top
half of it. It was fine. Scrolling first cost ten seconds; the finding would
have been wrong in a document whose whole claim is that it reports what actually
happened.

---

## The most-viewed file in the repository

`docs/stet.gif` is the README hero. It was recorded before the live preview
worked, before the address was withheld, before `.liveframe` existed and before
the one-line ask — so the first thing anyone saw was a tool that no longer
matched its own screenshots.

`stet demo` made re-recording it a two-minute job instead of a setup exercise,
which is most of the argument for having built it.

Six beats: the question; both signup flows running side by side; picked and
reasoned while still blind; the reveal with the rule and `synced → AGENTS.md`;
on to the next decision with the canon at 1.

Three things worth writing down.

**The recorder's defaults are for demos, not products.** Click indicators,
action labels, a progress bar and a Claude watermark, all on by default. Fine
for showing someone what an agent did; wrong on a repository's front page. All
off.

**A synthetic click does not land where a real one does.** Trying to click
*Continue* inside a live variant to prove the frames are interactive, the click
went to stet's own column picker instead — selecting B and typing the email
address into the reason field. A real mouse click is captured by the iframe;
the automation's is not. Not a product bug, but it cost a take, and it is worth
knowing that "click through it" cannot be demonstrated by a script.

**Six frames is a story, not a stutter.** The recorder captures one frame per
action, so a six-action sequence is six frames — against 211 in the old one.
Rather than manufacture motion, the frames were re-timed with ffmpeg through a
concat list, holding the reveal for 3.6 seconds because it is the frame that
carries the whole argument and 0.8 seconds is not long enough to read it.

Then the size question, which had a better answer than the obvious one.
Downscaling to the old 1100px looked like the way to keep the file small — 341KB
against 792KB. But GitHub renders a README image at about 830 CSS pixels, and on
a retina display a wider source renders at higher density rather than being
thrown away. At 96 colours the full 1520px encode lands at **531KB — byte for
byte what the old one cost**, at native resolution, with no visible banding in
the dark interface.

Same budget, sharper picture, and it shows what the tool actually does now.

---

## Somebody else used it

Every finding until now came from me running my own tool. Then it was used in
another repository, by a different agent (Kimi), mid-build, without restarting
the CLI — and it came back with a review.

That review is worth more than everything above it, because none of these were
reachable from inside my own head. It also contained one claim that is wrong,
which is its own lesson: a report from a real session is evidence, not a
verdict, and the fix depends on which parts survive checking.

Reproduced first, one at a time.

### Finding 29 — a question became rule 1 of somebody's canon

The verdict they typed was:

> they both look the same? can you please review

That is not a verdict. It is a message back to whoever queued the decision, and
the decision screen is not a reply box. It became **rule 1**, was written into
`RULES.md`, and was injected into `AGENTS.md` as binding on every agent in that
repository. On first use.

The README says stet *"warns you, offline and deterministically, when a rule
can't survive on its own"*. It does — for five things. Not for this:

```
PASSES "they both look the same? can you please review"
PASSES "why do these look identical?"
PASSES "can you please review this"
```

Every check was about a rule being *weak*. None asked whether it was a rule at
all. A question, an interrogative opening, a request aimed at a person — those
are now caught, and the message says what to do instead.

The interesting part was the second draft. My first version also caught these:

```
CAUGHT "do not centre the hero"                       ← "do"
CAUGHT "when the list is empty, say what to do next"  ← "when"
```

Both are good rules. And a warning that fires on a good rule is worse than no
warning, because it teaches people to click past warnings — which is exactly
how the sharpen step failed back in finding 5. The word list is narrower now,
and the test carries nine phrasings that must keep passing alongside the six
that must not.

### Finding 30 — the check exists twice, and I fixed one copy

The fix above was in `rules.ts`. The warning a human actually sees is rendered
by the page, and the page is a self-contained document with no imports — so it
carries **its own copy** of `weakness()`.

I only found it by grepping before declaring victory. Fixing one copy would
have left the warning silent in the one place it exists to appear, while every
test passed.

They cannot be deduplicated without giving the page a build step. So there is
now a test that pulls the function out of the page document, runs it, and
asserts both implementations agree — on the six that must be caught, the nine
that must not, and the older cases too.

### Finding 31 — there was no way back

They had to delete the decided item by hand and edit `RULES.md` in a text
editor. For a tool whose entire pitch is that the canon is binding the moment it
is written, "open the file and fix it yourself" is not an answer.

```bash
stet undo              # take back the last verdict, and the rule it earned
stet undo hero-type    # or a named one — it goes back in the queue
stet rule remove 4     # delete a rule outright
```

`undo` removes the rule, returns the decision to pending with the verdict, the
reason and the reveal stripped, keeps every variant and asset, re-syncs every
agent surface, and says plainly that judging it again will not be blind because
you have already seen the answer.

Removal does **not** renumber. A gap is harmless — the parser reads the number
from the heading — while renumbering would silently repoint every reference that
already exists, including the per-session record of which rules an agent has
been shown.

### Finding 32 — two variants that were the same variant

Their two text options rendered identically, so the screen asked a human to
choose between indistinguishable things. Whatever they pressed was noise, and
the reason they typed was the complaint that became finding 29. One bug caused
the other.

`stet ask` refuses now. Not just on identical text: local files are compared by
**content**, because the likeliest way an agent produces this is capturing the
same screen twice under two names and reporting success both times.

One exemption, found by my own test suite rejecting a fixture: a variant with
`blocks: []` renders nothing, and `[]` is documented as legitimate for an item
described entirely by its map. Nothing rendered is nothing to compare.

### Finding 33 — the help advertised a command that did not exist

```
$ stet serve
stet: unknown command "serve" (this is stet 0.19.0)
```

while the help line read `stet   init, wire agent surfaces, serve, watch,
notify`. That line describes what bare `stet` does, but it reads as a list of
subcommands. Their words: a trust-killer, before the tool has done anything
wrong.

`stet serve` is real now, the line is reworded, and a test walks every command
the help advertises and asserts none of them answer "unknown command".

### The one I did not reproduce

They reported that after their manual cleanup, `stet sync` said *unchanged*
while the canon and the injected block disagreed. I hand-edited `RULES.md` and
ran it:

```
-- hand-edited RULES.md, now running sync --
  updated   AGENTS.md
```

It detected the drift and re-injected. Most likely they had already edited both
files into agreement, which makes *unchanged* the correct answer. Reported as
not reproduced rather than fixed, because a fix here would be a change with no
bug under it.

### The one I am not going to build yet

Copy decisions render as naked strings, and their case — two toast messages —
was unjudgeable partly for that reason. The suggestion was to render text
variants inside representative chrome: a toast bubble, a hero slot, an
empty-state frame.

It is a real gap and the diagnosis is right. But which chrome, at which width,
for which of a hundred contexts is a guess, and a wrong guess ships a frame that
makes copy look better or worse than it is. The immediate harm — being asked to
choose between two identical things — is fixed. The rest waits for a real case
rather than my imagination of one.

### And the one that cannot be fixed the way it was asked

`npx stetmark` ran a cached **0.4.0** that had never heard of `init`, while
0.18.0 was on the registry. The suggested fix was a startup version check
against npm.

stet says, on its front page, that nothing leaves your machine and it never
touches the network. A background request to a registry on every invocation
would trade the tool's single strongest promise for a papercut. The honest fix
is the install line itself: every `npx` example now pins `@latest`, with a
sentence saying why — `npx` will happily run whatever npm cached months ago, and
stet cannot tell you it is stale without doing the thing it promises not to do.

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
| 20 | a real dev server | `loading="lazy"` on an iframe in a collapsed box: 0×0 never enters the viewport, so it never loads — both previews were blank |
| 21 | the same dev server | the sandbox gave every embedded app an opaque origin: `localStorage` threw and `fetch` failed in anything real |
| 22 | a screenshot of that page | `.live` styled both the frame and the connection indicator; a `min-height` grew the status dot into a 480×300 box over the header |
| 23 | installing from npm | the published 0.16.0 identified itself as 0.15.0 — and that constant is what the version-skew check reports, so the safety net lied |
| 24 | typing `--help` | `--version` and `--help` were unreachable cases; both fell through to the default command, wrote a project into the current directory, and hung |
| 25 | scoping a rule | `--globs` was parsed, read by nothing, and dropped while printing success — and every command silently ignored every unknown flag |
| 26 | wiring a fresh project | the wiring detected that the gate it had just installed does nothing, and wrote it anyway |
| 27 | malformed agent input | missing `map` or `variants` crashed with an internal TypeError; a missing question or an unknown block kind queued successfully and rendered a decision nobody could act on |

| 28 | the shorthand | the page printed each variant's URL under its panel — with `--url` the easy path, a descriptive address hands the human the answer |
| 29 | a test I expected to pass | `localhost:5173` parses as scheme `localhost`, path `5173` — the URL was left unmodified while `127.0.0.1:5173` was fixed |
| 30 | fixing a flaky harness | `--port 0` — "let the OS choose" — was read as unset by `Number(v) \|\| undefined` and became the default port, where callers raced |
| 31 | the same flaky harness | a `close` listener attached after the child had already exited, waiting forever for an event that had fired — the race stet's own `await` had |
| 32 | `stet demo` | `url` was the one block kind never absorbed on intake: a relative href was neither copied in (blank frame, 404) nor renamed (the filename announced the variant) |
| 33 | a grep that found nothing | a raw NUL byte in `src/store.ts` made the file read as binary, so every search in it silently returned nothing |
| 34 | the demo's first screen | seven items queued in one millisecond tie on `created` and fall back to sorting by id, opening the tour on an API envelope |
| 35 | **someone else's first use** | a question — "they both look the same? can you please review" — passed every rule-quality check and became rule 1 of their canon, injected into AGENTS.md |
| 36 | grepping before declaring victory | that check exists twice; the page carries its own copy, so fixing `rules.ts` alone left the warning silent in the only place a human sees it |
| 37 | the same session | no way to take back a verdict or delete a rule: hand-delete the directory, hand-edit RULES.md |
| 38 | the same session | two variants rendered identically and the screen asked for a choice between them — which is what produced the junk verdict in 35 |
| 39 | the same session | the help advertised `stet serve`; typing it answered "unknown command" |

The pattern is consistent enough to be a rule: **the failures that matter are
invisible from the code and obvious from the use.** Eight of the thirty-nine
announced themselves — 5, 6, 7, 14, 24, 26, 31 and 39 — and they are the boring
kind: a hang, a non-zero exit, a warning printed before proceeding anyway. The
other thirty-one reported success while broken.

Findings 35 to 39 are the first that came from **someone other than the author**,
in a repository I have never seen, and they are the densest run in this log: five
real bugs in one session, including the worst one here — the canon, which is the
whole product, accepting something that was not a rule and binding every agent in
that repo to it. Thirty-four findings of my own use did not surface it, because I
never typed a question into that box. I knew what the box was for.

Number 31 is worth its own line, because it is the only one I had already
fixed. The check-then-watch race closed inside `stet await` came back in the
harness that guards the release, while I was testing something else. Knowing a
bug intimately does not stop you writing it again somewhere it is not being
looked for.

Findings 23 to 27 all came from one decision: install the published package
instead of testing the source tree. Ninety-four passing tests and three stress
suites could not see any of them, because every one of those ran against `src/`.
The distance between *the code works* and *the thing I published works* was five
bugs wide, and the first three commands a stranger types crossed it.

Finding 10 is the one worth dwelling on, because it was not found by a test or a
crash — it was found by looking at what two real verdicts actually produced. The
mechanism worked exactly as designed and the design was wrong.
