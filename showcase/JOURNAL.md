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

## Fusing it with Claude Code

The goal for this pass was that stet should feel like an upgrade to Claude Code
rather than a tool bolted onto it. That meant looking at what Claude Code
actually offers and what stet was leaving on the table.

The first thing found was not a missing feature. It was a finished one that had
never been switched on.

### Finding 40 — the verdict bound tomorrow's agent, not the one waiting

```
$ stet hook events
{"version":"0.20.0","events":[…,"user-prompt"]}   ← six implemented
```

```
WIRING = [PreToolUse, PostToolUse, Stop, SessionStart, PostCompact]   ← five installed
```

`UserPromptSubmit` had been written, tested by the event dispatcher, and
advertised by the probe that checks a wiring against its binary — and never
added to the list of hooks the installer writes. Dead capability, reported as
present.

What it costs is specific, and it is the worst possible place for this tool to
have a hole. Trace a rule earned in the middle of a session:

```
1. session starts — agent is told the canon (rule 1)
2. mid-session, a decision lands and earns rule 2
3. what reaches the agent still working in that session?
   PreToolUse (unscoped rules never go here): [nothing]
   SessionStart:                              already fired
```

The verdict a human gives to unblock an agent **does not reach that agent**. It
governs the next session. The whole pitch is that an answer becomes binding, and
the one moment it most obviously should bind — the agent is *right there*,
waiting, having asked — was the moment it did not.

Wired, it delivers exactly the new rule and nothing else, because `canonOnce`
only ever sends what this session has not already been shown:

```
   UserPromptSubmit:
   stet canon — verdicts this repo's owner already gave. Binding:
   2. error copy names the next action, not the failure    ← only the new one

4. and on the next prompt: [nothing — already delivered]
```

One line in a table. It had been sitting there since the hooks existed.

### The human's half: /stet and /stet-undo

Hooks are the agent's half of the wiring. There was no human half — judging
meant leaving the session for a browser, and the previous release's `stet undo`
meant leaving it for a terminal.

`stet claude` now also writes two slash commands, so the loop is driven from
inside the session it interrupts. Each carries live state injected by the shell,
so Claude answers from what is actually in the repo rather than what it
remembers.

Which needed a primitive that did not exist: **`stet status`**. Every way to ask
"what is waiting?" started a web server and opened a browser — the wrong shape
for a person mid-session, for a slash command, or for anything that wants to
render the state elsewhere. It prints, and `--json` for anything that wants to
consume it.

### Finding 41 — pre-approving every node process to save one prompt

Slash commands take an `allowed-tools` line that pre-approves a command so the
user is not asked each time. `Bash(stet:*)` is exactly right.

But when stet is not on PATH the wiring pins an absolute path, and the command
becomes `node /abs/path/stet.js` — so the same line generated
`allowed-tools: Bash(/opt/homebrew/…/node:*)`, which pre-approves **every node
process on the machine** to save one permission prompt.

It is now omitted entirely in the pinned case. Claude asks once, which is the
correct trade, and the narrow form comes back as soon as `stet` is on PATH.

### Finding 42 — recognising its own files by content that varies

The first version refused to overwrite a `/stet` command the user had written
themselves, by checking whether the body contained `stet status`.

The pinned body does not contain that string. It says `…/stet.js status`. So
re-wiring silently declined to update **its own file** and left a stale command
pointing at the old binary — the version-skew failure again, in a new costume,
and one that would only appear for people who installed locally.

Ownership is a marker line now, written into every file it creates:

```
<!-- written by stet · safe to delete · `stet claude remove` -->
```

Never infer ownership from content that varies. A command the human wrote is
still never touched, and removal takes only what carries the marker.

---

## Pointing it at Claude Code, and finding a hook that never fired

The decision was to stop hedging across every agent and aim squarely at Claude
Code. Before designing anything new, one assumption in the existing wiring had
never been checked: that Claude Code emits the events stet listens for.

### Finding 43 — `PostCompact` is not an event

The authoritative list, from the official plugin-development skill on this
machine:

```
PreToolUse, PostToolUse, Stop, SubagentStop, SessionStart,
SessionEnd, UserPromptSubmit, PreCompact, Notification
```

There is no `PostCompact`. stet had wired it since the hooks existed. **That
hook has never fired, once, for anybody.**

And the README's third headline claim about Claude Code was *"Taste survives
compaction — `PostCompact` re-states the canon, because compaction is exactly
when your preferences get summarised away."* The mechanism named in that
sentence was never called. The code behind it is correct — it deletes the
session record so the canon will be restated, then restates it — and it has
been sitting there, correct and unreachable, the entire time.

The reason it hid is the part worth keeping. `stet claude status` reports:

```
verified against stet 0.22.0 — all 6 events implemented
```

That check is real. It spawns the binary the hooks actually point at and asks
which arguments it implements — which is how the version-skew bug was closed
four times. But it asks **our own binary**, about **our own argument names**.
Nothing ever asked whether Claude Code emits `PostCompact`. Both halves of that
check were written by the same person, so it could only ever agree with itself.

This is finding 1 wearing a different hat: a real check, run faithfully,
verifying the wrong half. There is now a list of the events Claude Code actually
emits, `stet claude` refuses to wire anything absent from it, and a test asserts
every wired event is real.

The corrected wiring is `PreCompact`, whose documented purpose is *"add critical
information to preserve"* — and it now pairs with the `UserPromptSubmit` hook
from the previous release: `PreCompact` restates the canon and forgets what the
doomed context was told, so the first prompt after compaction restates it into
the fresh one. Wirings written before this still call `stet hook post-compact`;
that argument is still answered rather than going silent on them, though it has
never been reached by anything.

### Finding 44 — twenty-five files of private state, one file worth sharing

`.stet/` is meant to be committed: `RULES.md` and `decided/` are the product,
and a canon that is not shared is not a canon.

After a day of work, `.stet/` contained twenty-six files. **Twenty-five of them
were per-developer session journals** — which rules an agent has been shown,
which files it revised — rewritten on every tool call, meaningless on anyone
else's machine, and a merge conflict in every commit.

`stet init` now writes a `.stet/.gitignore` covering `sessions/` and `*.lock`,
and never overwrites one the human wrote. What lands in git afterwards is the
canon and nothing else.

### The signal that was already being collected and half used

`PostToolUse` records which instruction caused each write, and `Stop` reports a
file revised across three separate instructions — the tool noticing, from the
other side, that a preference is being argued out loud instead of recorded.

It then suggested `stet rule "<the one line>"`. Unscoped. Which produces exactly
the kind of rule this project spent a release arguing is the weaker kind: it
waits at the top of the next session and competes with everything after it,
instead of arriving at the moment an agent touches that area again.

The churn signal already knows the path. It proposes the scoped form now:

```
  src/components/Button.tsx — revised across 3 separate instructions this session

  stet rule "<the one line>" --globs 'src/components/**'
```

One flag, and the mechanism the whole tool is built on is actually used by its
own suggestion.

### Two things checked and left alone

`sweepSessions` looked like dead code of the same species as the unwired hook —
it deletes session files older than a day, and nothing obvious called it. It is
called on `session-start`. Twenty-five files survived my test because all
twenty-five were minutes old, which is correct behaviour, not a leak.

And I wanted the `Stop` message to quote what the human actually said, rather
than counting distinct instructions. The journal stores a `prompt_id`, not the
text. `UserPromptSubmit` may carry the prompt itself, which would make that
possible — but I could not confirm the payload shape from anything on this
machine, and the honest move is to not build on an assumption about someone
else's schema. Noted, not built.

---

## Distilling the method, and what it exposed

The brief was to take the working method behind this log and fuse it with Claude
Code. The obvious move — write it up — is the one this project exists to argue
against: an instruction in a document is read once, competes with everything
after it, and is losing by turn sixty. The same is true of method as of taste.

So the method is a canon. Eight rules, each earned from a specific recorded
failure above, each carrying that failure in its body so the reasoning can be
checked rather than taken, and two of them **scoped** — so they arrive as a
system reminder at the moment an agent writes a test or touches the release
config, not as advice at the top of a session.

They pass stet's own quality check, all eight. A canon that fails its own gate
is not a canon.

It is never installed by `init`. A canon is a claim about what a repository
believes, and filling one with claims its owner never made is precisely what
this tool refuses to do everywhere else. `stet method`, or not at all.

### Finding 45 — every glob with a dot in it was silently broken

Writing the two scoped rules is what exposed it. The rule scoped to
`test/**, tests/**, **/*.test.*, **/*.spec.*` never arrived. The one scoped to
`package.json, .github/workflows/**, Dockerfile, Makefile` arrived on nothing.

The globs matched fine — checked directly against the matcher. The scope never
reached the matcher at all:

```
rule 3 globs: ["package"]     ← from: package.json, .github/workflows/**, Dockerfile, Makefile
rule 5 globs: []              ← from: test/**, tests/**, **/*.test.*, **/*.spec.*
```

Two bugs in one line of parsing. The field was read with `[^.]*`, which stops at
the first full stop — and a full stop is in almost every real glob. And the tail
around it was captured with a pattern allowing `\*(?!\/)`, a star not followed
by a slash, which `**/` violates on its second character.

So `package.json, …` became the single glob `package` — a rule quietly governing
a file that does not exist — and anything containing `**/` lost its scope
entirely, which silently demotes a just-in-time rule to a session-preamble one.

**Scoped rules are the mechanism this entire tool is built on.** The README
calls them the difference between a rule that arrives when it applies and a rule
that decays. And any scope written the way people actually write scopes —
`src/**/*.tsx`, `**/*.test.ts`, `package.json` — has been silently discarded or
mangled for the life of the project.

Nothing could report it. A rule that matches nothing does not fail; it simply
never arrives, which is indistinguishable from having nothing to say.

It survived forty-four findings and one hundred and thirty-four tests because
every glob anyone had ever tested with — `src/web/**`, `src/components/**`,
`src/api/**`, `web/**` — happened to contain no dots. Not one test used a file
extension. The test suite now walks six real shapes, including the three most
common ways anyone writes a glob.

### What the fusion actually looks like

```
$ stet method
  8 method rules added to the canon

$ # …later, an agent writes a test:
stet rules that govern test/thing.test.ts — binding, already decided by this repo's owner:
5. keep the reproduction as a permanent check, not only the fix

$ # …or touches the release config:
stet rules that govern package.json — binding, already decided by this repo's owner:
3. test the artifact you ship, not the tree you built it in
```

That is the distillation delivered the way this tool argues everything should be
delivered: not as a document somebody reads once, but as the right sentence at
the moment it applies, from a hook, to the agent that is about to need it.

And the rule that would have caught finding 45 is one of the eight:

> a green signal is not evidence — look at the artifact a person would actually
> touch

The scoped rules reported success. `stet method` printed `8 method rules added`.
The canon showed all eight. `stet rules` listed their globs. Every signal was
green, and two of the eight governed nothing at all until somebody fired a hook
at a real path and read what came back.

---

## The half that was missing

Asked what stet was still missing, I went back through all forty-five findings
with one question: what would have had to exist, at what moment, for that time
not to be lost?

The answer was not a feature I expected. Three of the forty-five are bugs that
had **already been fixed, written up, and then written again**:

- **20** — `loading="lazy"` collapsing to 0×0 was fixed for `<img>`, documented,
  and then reached for again on `<iframe>` a release later. The note in this log
  at the time: *"The lesson did not transfer, because I had filed it as a fact
  about images rather than a fact about deferred loading."*
- **31** — a check-then-watch race was closed inside `stet await`, then
  reproduced exactly in the harness that guards the release.
- **42** — identity inferred from content that varies, which is the same shape
  as 1 and 23. Three times. *"the version-skew failure again, in a new costume."*

Every one of them was written down. This log is fourteen hundred lines and it
has never once arrived at the moment it was needed.

Counting the rest the same way: **twenty-six of the forty-five were facts about
this codebase** — invisible from reading it, expensive to learn, cheap to state
once known. `weakness()` exists twice. `absorbAsset` covers image and audio
only. `Number(v) || undefined` eats a legitimate zero. Pending items sort by
`created` and same-millisecond ties fall back to id.

None of those are taste. No human decided any of them. And stet — a tool whose
entire architecture is *deliver the right sentence at the moment it applies* —
had nowhere to put them.

### The shape

```bash
stet note "the second copy of weakness() is here; rules.ts has the other" --globs 'src/page.ts'
```

Stored in `.stet/NOTES.md`, selected by glob, injected at `PreToolUse` beside
the rules, once per session:

```
stet rules that govern src/page.ts — binding, already decided by this repo's owner:
1. never centre the hero

stet notes for src/page.ts — learned here, not obvious from the code:
· the second copy of weakness() is here; rules.ts has the other
· no backticks inside the PAGE template literal — it breaks the build
```

The division is the interesting part, and it falls out of stet's own premise:

|  | rules | notes |
|---|---|---|
| what | a preference | a fact |
| who writes | only a human, after a verdict | an agent, the moment it learns one |
| force | binding | informational |

An agent cannot decide taste — that is why this tool exists. But an agent is the
best possible author of *"this is what just cost me an hour"*, and that half had
nowhere to go. Notes are the part of the canon an agent may legitimately write.

### Four decisions worth recording

**Scope is required.** A note with no globs has nowhere to arrive, which makes
it a document — and documents are precisely what failed three times above. The
error says so rather than defaulting to repo-wide.

**Rules are selected first, against the full budget; notes take what is left,
capped at four.** If they ever compete for room the binding one wins, and a
block of twelve notes is a block people learn to skip.

**Notes are numbered separately from rules**, with their own per-session
delivered-set. Both start at 1, and one shared namespace would have had rule 3
silently suppressing note 3 — a bug that would have been invisible and very hard
to find.

**The quality check is deliberately lighter than the one for rules.** A note is
allowed to be dull; it is only not allowed to be empty. `be careful with this
file`, `TODO fix later` and anything with a question mark are refused, because
those cost the same tokens as a fact and teach the reader to skim. Everything
else passes — finding 29 is a standing reminder of what an over-eager warning
costs.

### And the parser that had just been fixed

The provenance line in `NOTES.md` has the same shape as the one in `RULES.md`,
which meant it was a candidate to inherit finding 45 — the `[^.]*` that
truncated every glob containing a full stop. It was written the corrected way
from the start, and there is a test asserting `package.json`, `**/*.test.*` and
`src/**/*.tsx` all survive the round trip.

Which is itself the argument for this feature: that bug was fixed forty minutes
earlier, and the only reason it did not immediately reappear in a new file is
that it was still in working memory. It is now note 4 in this repo's own
`.stet/NOTES.md`, scoped to `src/rules.ts` and `src/notes.ts`, so it will not
depend on that next time.

---

## The check that was never possible to fail

After shipping notes I turned the method on stet itself: what has never actually
been verified? Everything in this log was tested through synthetic hook
payloads, fed to the binary by hand. Nothing had ever confirmed that **Claude
Code calls any of it.**

The investigation started by accident. `.claude/` in stet's own repo was empty
and `stet claude status` said *not wired* — yet `.stet/sessions/` held a journal
named with this session's id. So hooks had fired here, at some point, and then
the wiring was removed.

Working that out required listing a git-ignored directory by hand and reading
raw JSONL. That is the whole finding: **there was no way to ask.**

### What `stet claude status` could and could not say

```
wired — .claude/settings.local.json          ← read from a settings file
verified against stet 0.24.0 — all 6 events  ← asked of our own binary
```

Both are declarations. One reads a file that says a hook exists. The other asks
our own code whether it implements an argument our own code named. Neither can
observe Claude Code doing anything, and `PostCompact` — finding 43 — satisfied
both of them for the entire life of the project while never being called once.

There is now a third line, and it is the only empirical one:

```
  PreToolUse        seconds ago
  PostToolUse       never called
  Stop              never called
  SessionStart      seconds ago
  PreCompact        never called
  UserPromptSubmit  never called
```

An empty file per event, truncated on each call, with the mtime as the entire
payload. No parsing, no growth, and concurrent writers cannot corrupt a file
with nothing in it — which matters, because this runs on the path that fires on
every tool call in every parallel agent. Measured at **0.01ms per call**; the
hook total is 57ms median, which is process startup and unchanged.

Three details that were decided rather than defaulted:

**The marker is written before dispatch, not after.** Most hook invocations
return `null` — a `PreToolUse` on a file no rule governs has nothing to say. If
only the ones that spoke were recorded, a correctly wired but quiet hook would
read as *never called*, which is exactly the false alarm this is meant to
remove.

**`sweepSessions` skips it.** The sweep clears session state older than a day.
A fired-marker older than a day is not litter — it is the finding. *"Nothing has
called PreCompact in a week"* is precisely what you want the report to say.

**The summary line does not say "verified" when the probe said otherwise.** The
first version printed *"the stet these hooks call is too old"* and then *"wired
and verified, but Claude Code has never called any of it"* — two contradictory
lines in one report, which teaches people to read neither.

### What this closes

The version-skew bug in this project recurred four times and finding 43 was its
worst form: every safeguard green, the hook never called. The pattern each time
was a check that could only agree with itself, because both halves of the
conversation had the same author.

This is the first check in stet that can fail for a reason nobody wrote. It does
not ask our code anything. It reports whether something outside stet has, in
fact, called it — and if the answer is *never*, it says the thing nobody thought
to say out loud: hooks load when a session starts, so restart Claude Code.

---

## Cleaning the workshop

The report was that several stets were in play at once while building stet. It
was right, and the cause was worse than untidiness.

### Finding 46 — the `stet` on PATH was twenty-one versions old

```
$ stet --version
  stet — let it stand          ← not a version. 0.4.0 had no --version.
$ npm ls -g
  └── stetmark@0.4.0
```

A global install from the first day of the project, still first on PATH twenty-
one releases later. It predates `init`, `demo`, `note`, `method`, `undo`,
`status`, `serve`, the one-line ask, the glob fix and the `PreCompact` fix.

It was never *wrong* — every `stet claude` run in this repo had detected it,
said so, and pinned an absolute path to the working tree instead. The machinery
built across findings 1, 23, 26 and 43 did exactly its job, quietly, for a day
and a half. But it meant a stray `stet` in a terminal answered from 0.4.0, and
that is the confusion.

Fixed by `npm link`, so `stet` anywhere on this machine *is* the checkout, and
written down in a new `CONTRIBUTING.md` as the first thing anyone is told.

The banner-instead-of-a-version in that output is finding 24 demonstrating
itself live: `--version` was an unreachable case that fell through to the
default command.

### Finding 47 — the stress suite was firing hooks at the developer's own repo

While wiring this repo under its own gate, `stet claude status` reported four
events called *6 minutes ago*. Nothing had called them. The repo had been wired
seconds earlier.

`test/stress.mjs` fuzzes the hook CLI with hostile input — `''`, `not json`,
`{}`, `null`. It spawned the binary **without a `cwd`**, and a payload with no
`cwd` field makes the hook fall back to the project containing the process:
the checkout. Forty combinations, five events, fired at the real repository.

Harmless for a year of the project's life, because a hook against a repo with
nothing pending does nothing observable. It stopped being harmless the moment
the previous release added a record of *which hooks have actually been called* —
the test was writing false evidence into the one check built to be trustworthy,
and the first thing that check ever reported here was a lie.

Both fixed: the spawn passes `cwd`, and two assertions now guard it — one in the
fuzz section that pinpoints it, and one at the end of the last suite in the run,
which sees anything any of the four left behind.

There is a general rule in this, and it is now note-shaped: **a test that writes
into the tree it runs from cannot be trusted about that tree.**

### `stet rule edit`

Cleaning the canon needed it. Rule 1 of this repo's own canon read *"I think go
with the flow"* — a real verdict with useless wording, and precisely what the
rule-quality check now catches.

Sharpening was reachable only from the decision page, in the seconds after a
reveal. A week later the only options were delete it or hand-edit `RULES.md`,
which is the same answer that made `undo` necessary two releases ago.

```
$ stet rule edit 1 "the sharpen field takes focus the moment the reveal lands"
  was I think go with the flow
  1  the sharpen field takes focus the moment the reveal lands
```

The scope, the tags and the provenance survive — it is the same rule, better
said. And it warns if the new wording is still not a rule.

### What the workshop looks like now

`stet` on PATH is the working tree. The repo is wired under its own gate, six
hooks and two slash commands. Its canon holds a real verdict and the eight
method rules; `.stet/NOTES.md` holds eight landmines, and both are committed.
The stale empty `.claude/`, a `.DS_Store` and two pre-0.5 session files in the
superseded `.json` format are gone.

The one thing `stet claude status` still says is honest and expected:

```
  ! wired and verified, but Claude Code has never called any of it.
    hooks are loaded when a session starts — restart Claude Code, then check again.
```

---

## Working under its own gate, and a tidy-up

The wiring was verified from the inside for the first time. Restarting Claude
Code, `SessionStart` delivered this repo's canon as a system reminder — six
method rules, arriving before any work began — and the first edit to
`src/rules.ts` produced this, unprompted:

```
PreToolUse:Edit hook additional context: stet notes for src/rules.ts:
· the second copy of weakness() lives in src/page.ts; src/rules.ts has the other
· the provenance line is parsed by reading to the next field label, not the next full stop
```

Both notes were written yesterday, by hand, about bugs that had already cost a
cycle each. Neither had to be remembered.

### The report that looked wrong and was not

The terminal said `SessionStart never called` while its output was demonstrably
in the agent's context. The markers on disk settled it: `.fired-stop` at 13:33,
`.fired-session-start` at **13:35**, `.fired-user-prompt` at 13:36. The status
command had been run after the restart but before the resume — accurate at the
moment it was taken. Reproduce before changing anything, and say plainly when it
does not reproduce, which is rule 2 of the canon that had just been injected.

### Finding 48 — a dead export, two releases old, written here

A scan for exports nothing references turned up `restatesOption` in
`src/rules.ts`: written in 0.20.0 alongside the question-detection fix,
exported, and never called by anything. It would have flagged a verdict that
merely repeats the option it chose.

Same species as finding 40 — implemented, plausible, never wired — committed by
the same author two releases after writing that one up.

Deleted rather than wired. The idea needs a warning that fires on a failure
nobody has observed, and this canon says a warning that fires on correct input
trains people to ignore warnings. It is ten lines if evidence turns up.

The scan is now a test, so the next one cannot sit for two releases. Exported
types are exempt: an interface used only as an inferred return type has no
textual reference, and demanding one would be exactly the over-eager warning
being argued against.

**The first version of that scan was itself wrong.** Written inline through a
shell, it over-escaped its own regex — `\\b` reached JavaScript as a literal
backslash — so every count came back zero and it reported ninety dead exports
including `PAGE`, `serve` and `runHook`. A red signal is no more evidence than a
green one; the instrument gets checked either way.

### The tidy-up

`claude()` was 173 lines doing three unrelated jobs. Split into
`claudeRemove`, `claudeStatus` and the install path: 107 lines, byte-identical
behaviour on all three.

The comma-splitting helper existed **five times across three files**, under
three different parameter names, and not all of them guarded the non-string
case — so `--tag` with no value threw where `--globs` with no value returned
nothing. One `commaList` now, in `src/text.ts`.

### Finding 49 — my own guard fired on correct input

The check added in the last release asserted that the suites leave no
fired-markers in the checkout. It failed on this very run — correctly, and for
the wrong reason: this repo is now wired under its own gate, so an ordinary edit
during development writes a marker. The suite had touched nothing.

The assertion was the wrong shape. What matters is not that no marker exists but
that the suite **changed** none: fingerprint them before the run, compare after.
Written the first way, it would have failed for every contributor doing exactly
what `CONTRIBUTING.md` tells them to do — which is the definition of a warning
people learn to ignore, and it was caught by the canon rule saying so.

---

## Finding 50 — the sentence that starts the loop was on the unverified channel

Working under stet's own gate, the canon arrived at session start as a system
reminder. The instruction telling an agent *to ask in the first place* did not.

That instruction lived in `AGENTS.md`. Every other thing stet says travels
through a hook — and as of the previous release, those hooks are provably
called. `AGENTS.md` had never been checked against anything.

Against the other side's list:

```
$ rg -o "CLAUDE\.md|AGENTS\.md" <claude-code's own plugin marketplace> | sort | uniq -c
  125 CLAUDE.md
    1 AGENTS.md
```

The single `AGENTS.md` mention is a security agent listing untrusted data
sources, not a memory file being loaded. And stet writes `CLAUDE.md` **only if
it already exists** — this repository has none, so the entire activation
instruction was sitting in a file with no evidence that Claude Code reads it.

The canon travelled on a channel verified to fire. The sentence that causes
anything to happen at all travelled on a declaration.

That is the same shape as finding 43 — `PostCompact` — one layer up: not a hook
wired to an event nobody emits, but the most important text in the tool routed
through a file nobody confirmed is read.

### The fix, and what it cost

`HOW_TO_ASK` is one exported string now, used by both the `AGENTS.md` block and
the `SessionStart` hook. One source, because two copies of the sentence that
starts the loop would drift and the drift would be invisible — each channel
looking fine on its own. A test asserts the file surface contains exactly the
string the hook sends.

It is sent even when the canon is empty. A repository with no verdicts yet is
precisely the one that needs an agent to know it can ask; before this,
`SessionStart` returned nothing there at all.

**224 tokens, once per session**, and once more on the far side of a compaction
— because `PreCompact` clears the session record, so the first thing said into
the fresh context is how to ask.

### Two corrections the existing tests forced

Making it unconditional broke four tests, and all four were right.

Three asserted that a *second* `SessionStart` in the same session says nothing.
That property matters and I had discarded it. The instruction is deduplicated
per session now, like the rules and the notes — recorded in the same session
journal.

The fourth was `runHook('/does/not/exist', 'session-start', {})`, which had
started returning the instruction. Explaining `stet ask` in a directory with no
`.stet/` is noise, and an agent acting on it would create a project nobody asked
for. It says nothing outside a project now, and there is a test for that too.

Four failing tests, four real defects in a change that looked finished.

---

## Reading the contract instead of guessing at it

Two releases ago the churn report was left counting instead of quoting:

> I wanted the `Stop` message to quote what the human actually said rather than
> counting distinct instructions. The journal stores a `prompt_id`, not the
> text. `UserPromptSubmit` may carry the prompt itself, which would make that
> possible — but I could not confirm the payload shape from anything on this
> machine, and the honest move is to not build on an assumption about someone
> else's schema. Noted, not built.

The schema is on this machine, in Claude Code's own plugin-development skill:

```
**Event-specific fields:**
- PreToolUse/PostToolUse: tool_name, tool_input, tool_result
- UserPromptSubmit: user_prompt
- Stop/SubagentStop: reason
```

`user_prompt`. It was documented the whole time; the earlier search had looked
for the wrong string. Not building on the assumption was right — and so was
going back to check rather than leaving it noted forever.

### The join needed no new field

`UserPromptSubmit` carries the text. `PostToolUse` carries a `prompt_id`.
Nothing documented links them.

It does not need to. The session journal is append-only and written in order, so
the most recent prompt recorded before an edit **is** the instruction that
caused it. One variable while scanning the file, and no dependency on a field
that may not exist.

### What the report says now

Before:

```
  src/components/Button.tsx — revised across 3 separate instructions this session
```

After:

```
  src/components/Button.tsx — revised across 3 separate instructions this session:
    · "make the button label say what actually happens"
    · "shorter — Buy now, not Purchase this item"
    · "and keep it lowercase like the rest of the app"

  stet rule "<the one line>" --globs 'src/components/**'
```

The count says a file was argued over. The words say what the argument was
about — and the third one there is visibly taste rather than a bug, which is the
judgement the whole signal exists to prompt and could not previously support.

The fallback is silent and deliberate: a session that predates this, or an edit
with no preceding prompt, still reports the count. Missing evidence is not an
error.

### The human's text on disk

This is the first thing stet stores that the human typed. One line, collapsed
and capped at 160 characters, in `.stet/sessions/` — which `stet init`
git-ignores and stet sweeps after a day. Both bounds are tested, because "we
only keep a little of it" is a claim like any other.

### Two existing tests that changed shape honestly

`churn()` gained a `said` field, and two tests asserting its exact object
failed. They were updated to state the new shape rather than loosened to accept
any shape — a test that stops describing the thing it tests is worse than one
that fails.

---

## Finding 51 — the gate is not on until the next session, and nothing said so

Setting up a fresh project to test the tool honestly, the transcript ran:

```
$ stet init          initialised .stet
$ stet claude        stet is now a gate in this repo, not a suggestion.
$ stet status        nothing waiting on you · 0 rules in the canon
```

Three commands, all reporting success, and the gate was not running. Nothing in
any of that output says when it will be.

Claude Code loads hooks when a session starts and snapshots them — deliberately,
so a settings file cannot be swapped underneath a session that is already
running. Its own documentation is explicit:

> **Important:** Hooks are loaded when Claude Code session starts. Changes to
> hook configuration require restarting Claude Code.

There is no bypass, and there should not be. It is a security property, not a
gap. What is a gap is a tool that writes a configuration, prints *"stet is now a
gate in this repo, not a suggestion"*, and never mentions that the sentence is
not true yet.

The failure mode is specific and quiet: someone wires from inside a running
session, keeps working, sees no gate, and concludes the tool does not work.

### The distinction that matters

The obvious fix — "restart Claude Code" — is wrong half the time. A folder that
has never had a session needs no restart, only a start. Telling everyone to
restart sends people to fix something that is not broken, which is its own kind
of noise.

`stet claude` now ends on the two cases separately:

```
  these are not live yet. Claude Code loads hooks when a session starts.
    starting Claude Code here for the first time? nothing to do — just start it.
    already have one open in this folder? exit and run claude again.

  then stet claude status will show them actually firing.
```

And `stet status` repeats it, but only while it is true — wired, with no hook
ever called. The moment one fires, it goes quiet. A warning that outlives its
condition is the kind people learn to skim past.

This was only findable by setting the tool up the way a stranger would, in a
directory that had never seen it, and reading what came back rather than what
was expected. That is finding 23 through 27 again, in the onboarding rather than
the package.

---

## The first real test: a stranger's project, a fresh agent, no mention of stet

Fifty findings in, the question was whether any of this helps build something
that is not stet. So: a new folder, `stet init`, `stet claude`, and a prompt for
a focus timer that never mentions stet. The prompt deliberately closed off the
easy escape — *"Don't ask me a pile of questions up front — build it and show
me."*

I predicted, on the record, that it would not ask and would guess.

**It asked.** Seventeen minutes of work, and at the end:

> *I filed the background-tab constraint I hit as a stet note, and queued one
> stet ask on the accent colour.*

Both verified against the artifacts rather than taken on the agent's word.

### The note is exactly what the feature is for

> The fuse ticks deliberately have NO css transitions. Chrome freezes css
> animation/transition timelines in an occluded or unfocused tab, and this timer
> is designed to sit in a background tab — a tick caught mid-transition strands
> at the wrong colour and the fuse reads as a lie.

Discovered the hard way, mid-session, after the agent measured rather than
guessed. Scoped to the file. It explains *why the code looks strange*, which is
the single most expensive thing to rediscover. Nobody prompted this; the feature
was named once, at session start, in the hook.

### Finding 52 — the blind test, defeated by a parenthesis

The decision it queued:

```
question: "The accent colour — I picked warm apricot (#D98E63) for a
           low-arousal, easy-at-night feel. Which do you want?"
A: "Warm apricot #D98E63 (current)"
B: "Pale signal blue #7FA6D9"
C: "Cool celadon #7FB09A"
```

stet did everything it was built to do. It stripped the map. It shuffled the
labels so the authoring order carries no signal. And then the variant text said
`(current)` and the question said *"I picked warm apricot"*.

**Whichever label shows `(current)` is the agent's pick.** The entire guarantee
— the thing the product is named for — was voided by content the agent wrote
inside the item, through a hole no mechanism was watching.

The shuffle protects against ordering. Nothing protected against a variant
announcing itself.

Refused now, in both places it can leak: a parenthesised annotation in a
variant, and a first-person claim in the question. The check is deliberately
narrow — `(current)`, `(existing)`, `my pick`, `I picked` — and explicitly does
**not** fire on a bare "currently" or "now", because *"Buy now"* is this
project's own worked example and ordinary interface copy says both. There is a
false-positive corpus in the tests for exactly that reason.

### Finding 53 — a colour, asked as three hex codes

The same item is unjudgeable. You cannot pick an accent colour by reading
`#7FB09A`. This is the failure an outside reviewer reported at 0.20 — naked
strings for something inherently visual — and it is worse here, because the
tool's whole pitch is *the real artifact, not a snippet*, and the agent had
`--url` and `--image` in the instruction it received at session start.

Guidance alone did not work. `stet schema` now says it in the imperative, next
to the flags: **show the thing, not a description of it.** Whether that is
enough is the next thing to test rather than assume — a heuristic that tries to
detect "this decision is visual" would fire on real text decisions, and finding
29 is a standing reminder of what that costs.

### And one that is only visible from the other side

The decision claims `index.html` — the whole file — for a question about an
accent colour. Correct in shape, over-broad in practice: every future edit to
the entire application is denied until somebody picks a colour. Left as it is
for now, because the alternative is stet second-guessing a scope its author
understood better than any rule could.

### What the test actually settled

The activation works. An agent that has never seen this tool, told once in a
hook, used both halves correctly and unprompted — and the half I was least sure
about, notes, produced the most obviously valuable artifact of the run.

What the loop does *not* yet guarantee is that the decision arriving at the
human is worth their attention. That is now the open question, and it is a much
better one than the one we started with.

---

## Finding 54 — a question that should not have been asked had no exit

Immediately downstream of the last two findings, and only visible because
somebody was standing in it.

The focus-timer project had one pending decision: the accent colour, asked as
three hex codes, announcing its own answer. Two things were true at once —
it was not worth judging, and it claimed `index.html`, so **every further edit
to the entire application was denied until it was ruled on**.

There was no way out. `stet undo` walks a *decided* item back to the queue.
Nothing walked a queued item out of it. The only exit was deleting a directory
by hand, which is exactly the answer that made `undo` necessary two releases
earlier — repeated, in the state where it costs more, because a pending
decision is not inert. It holds a gate.

`stet undo <id>` handles it now, as one idea rather than a second verb: take the
decision back a step. Decided goes to pending; pending goes away.

```
$ stet undo the-accent-colour-i-picked-warm-apricot
  discarded the-accent-colour-i-picked-warm-apricot — never decided, nothing earned from it
  writes into index.html are no longer denied
```

Two deliberate details. It says the block is lifted, because that is why anybody
would run it. And it refuses to discard by defaulting to "the last one" —
taking back a verdict is recoverable, since the decision returns to the queue,
but deleting a queued question is not, so it requires the id spelled out. Asking
for the default prints the command that does what you meant:

```
$ stet undo
stet: nothing has been decided yet. to discard a question instead:
      stet undo the-accent-colour-i-picked-warm-apricot
```

Three findings from one real decision in one real project, and none of them were
reachable from inside this repository.

---

## The screenshot that said the tool could not work

A screenshot arrived with a sentence attached: *"why would i pick a color i
cant even see there? thats code... i think my goal is not possible, and stet
has no option to succeed."*

The screenshot was right. The conclusion was not, and the difference is the
most useful thing in this log.

What was on screen: three cards reading `Warm apricot #D98E63 (current)`,
`Pale signal blue #7FA6D9`, `Cool celadon #7FB09A`. Nobody can pick a colour
from that. The tool had faithfully rendered exactly what it was handed, and
what it was handed was unjudgeable.

Ninety seconds later, the same decision, using nothing that did not already
exist: three copies of the user's own timer, identical but for the accent
variable, queued as live `--url` variants. Three running apps side by side, the
accent visible in the fuse ticks, labels shuffled, blind.

**stet could always do this.** The agent chose text. The tool accepted it.

### Finding 55 — the key that advertised the wrong thing

Visible in the same screenshot: the verdict bar read `C 3` and
`something else 3`. Two buttons, one key.

The handler was correct — `3` picked variant C, and the "something else" branch
was guarded to fire only below three variants. So the key did the right thing
and **the label lied about it**, and with three variants there was no key at all
for the thing the label named. The number is derived from the variant count on
both sides now.

Finding 39 — the help advertising a command that does not exist — repeated in
the interface rather than the CLI.

### Finding 56 — three live frames overflowed their columns

Once the good decision rendered, the frames were 480px wide inside 427px
columns. The page scrolled sideways and the third variant ran off the edge.

`.liveframe` carried `aspect-ratio:16/10` and `min-height:300px` and no width.
Given only those, the browser resolves the other way: 300px tall at 16/10 is
480px wide, and that beat the grid column. Two variants never showed it, because
two columns on any normal screen are wider than 480. It took a third variant to
make the constraint bite — and the only reason there was a third variant is that
a stranger's agent asked a three-way question.

### And one landmine walked straight into

Fixing that, the build broke. The comment written into `src/page.ts` contained
backticks, which terminate the template literal the whole document lives in.

There is a note in this repository about exactly that, scoped to exactly that
file. It did not fire, because the edit was made by a Python script rather than
the Edit tool — no `PreToolUse`, no hook, no reminder. The gate protects an
agent editing a file. It cannot protect a script writing one.

That limitation is now itself a note, which is the only honest thing to do with
it.

---

## The second run, and what a good decision exposed

Same project, one prompt: make the break screen unmistakable, make the round
counter louder, *both of these are look-and-feel*. No mention of stet.

The difference from the first run is stark. It built **six** live previews —
three genuinely different mechanisms for each question, generated from the real
`index.html` on a scaled clock so rounds turn over while you watch — queued both
through the long form, and said why:

> *stet requires showing the thing rather than describing it, and hides which
> option is which. Using the long form so the descriptions stay sealed until you
> rule.*

That sentence is the guidance added in 0.31 coming back out of an agent that had
never seen this repository. It also recognised the transition footgun as a
repeat — *"this is the second time that footgun has bitten in this file; it's
recorded as a repo note"* — and scaffolded `index.html` inertly so the visual
changes only land after a verdict, because it understood the file was gated.

Then it did two things nothing was watching.

### Finding 57 — an agent can take back the denial it is standing behind

It was blocked: the accent decision from the previous run claimed
`index.html`. So it ran `stet undo` on that decision and carried on.

Its reasoning was sound — the question was a genuine duplicate of one already
queued, and it said so in its summary. But the capability is the finding.
`stet undo <id>` is in the CLI, and nothing can distinguish a human typing it
from an agent running it to unblock itself.

*"An instruction can be ignored. A denied tool call cannot"* is the sentence this
whole tool rests on. It is only true if removing the denial leaves a mark.

Discarding no longer deletes. The question moves to `.stet/discarded/`, and
`stet status` reports it by name. Forbidding it would be worse — the first agent
to do it was right — but the person the question was addressed to should not
have to notice by absence.

### Finding 58 — a decision that evaporates

```
accent-live    A-1.html  B-2.html  C-3.html          ← copied in
break-screen   http://localhost:8731/previews/…      ← a server it started
round-counter  http://localhost:8731/previews/…      ← a server it started
```

The decision queued by hand used relative paths, so stet absorbed the files into
the decision directory and they outlive everything. The agent's two point at a
preview server it spun up mid-session.

A decision waits for a human — that is the entire premise, and the README says
so. It may wait overnight. That server will not. The moment it stops, both
decisions render as blank frames with nothing to explain why, and the human is
left looking at an empty screen wondering what broke.

stet accepted both silently.

Now: `stet ask` says it at queue time, naming the durable alternative. And
`stet status` probes the loopback origin of every pending decision and reports
the ones that are not answering — quiet when the server is up, explicit when it
is not:

```
  ! break-screen shows http://localhost:8731, which is not responding.
    its variants will render blank until that server is running again.
```

That check only ever talks to a loopback address, on a decision that already
exists. Nothing leaves the machine.

### What the two runs together show

The first run asked a question nobody could answer. The second asked two good
ones — because the schema told it to show the thing rather than describe it, and
because a note it had written itself came back and stopped it repeating a bug.

Both runs produced findings that were unreachable from inside this repository,
and every one of them came from watching an agent that had never seen the tool
use it on something that was not the tool.

---

## The first canon built by somebody else

Three decisions judged, in a real project, by a real person. The canon that came
out:

```
1  i love how the color blue looks with that palette
2  i dont see a difference between abc so A it is
3  i like the Round 01 text and looks
```

Three rules, none of them a rule, all of them now binding on every future agent
in that repository. This is the product — the thing everything else in stet
exists to fill — and its first real contents are noise.

Run against the check that is supposed to prevent exactly this:

```
PASSED  "i love how the color blue looks with that palette"
PASSED  "i dont see a difference between abc so A it is"
CAUGHT  "i like the Round 01 text and looks"
```

### Finding 59 — a denylist of verbs, and every new person brings a new verb

The first-person check was a list: *think, guess, feel, like, prefer, would,
reckon*. It was written after "I think go with the flow" got through in this
repo, and it was extended to exactly the verb that had failed.

"i love" is not in the list. Neither is "i dont". Enumerating the ways a
sentence can be about its speaker is a losing game.

A rule essentially never begins with the word "I" — not one of the eight method
rules does, and neither does any rule anyone has written here on purpose. So
that is the check now: `^i\b`. Ten real rules pass it, including the awkward
ones that start with a preposition or a noun.

Rule 2 carried a second failure the label check missed. `\b[ab]\s+(is|was)\b`
catches "A is" but not "so A it is" — deciding out loud rather than instructing,
in a grammar the pattern had not seen.

### Finding 60 — the screen wrote the sentence it had just refused

Rule 3 *was* caught. It went in anyway, and not because anybody insisted.

The reveal step is careful: when the reason will not survive as a rule, the
sharpen field starts **empty**, the placeholder says *"your reason will not work
as a rule"*, and the button reads *"let it stand anyway"*. That was finding 5's
fix — make the weak outcome cost something.

One line under it:

```js
var injected = text.trim() || original;
```

Type nothing, press Enter, and the fallback injects the very reason the screen
had just refused. The protection was real and the default defeated it — a screen
that says *this will not work* and then does it anyway if you do nothing.

Now an empty box means what it says. The verdict is recorded and keeps its
reason; the canon takes nothing. The button says so — *keep the verdict, no
rule* — and the preview reads *nothing — the verdict stands, the canon takes no
rule*.

### The part that is not about wording

Rule 2 is also a report: *"i dont see a difference between abc"*. Three variants
were built as three genuinely different mechanisms, rendered live, and the human
could not tell them apart. Whatever else is true, that decision was not worth the
interruption, and no amount of rule-quality checking fixes it.

stet can refuse a question that announces its own answer, and one whose variants
are byte-identical. It has nothing to say about three variants that are
*different in the code and the same to a person* — which is the harder and more
common failure, and the next honest thing to work on.

---

## What it turned out to be

Two numbers, counted rather than argued:

```
1,813 lines   the decision screen   →  5 decisions ever, 1 usable rule
1,820 lines   the memory layer      →  worked every time it ran
```

The decision screen is not broken. It is careful, tested, and beautiful, and it
is for a situation that turns out to be rare: forks worth stopping a human for
are much less common than assumed, and agents reliably ask about the wrong ones.
Three live previews of three genuinely different mechanisms produced *"i dont
see a difference between abc"*. No amount of validation fixes that.

Meanwhile notes went in eleven releases ago, almost as a side thought, and are
the only part of this tool a stranger's agent picked up unprompted, used
correctly, twice, in a project that had nothing to do with stet — and the second
time it recognised its own note and avoided repeating a bug it had already paid
for.

So the product was renamed to the thing that works.

> **Claude Code forgets what your codebase taught it. stet remembers, and tells
> the next agent at the moment it matters.**

Nothing was deleted. The decision screen is a section rather than the identity,
and the gate stays for the rare real fork. What changed is which half the front
page, the help text and the agent brief lead with.

### The one substantive change: notes arrive on read

They only ever arrived when an agent *wrote* a file. That is the right moment
for a rule, which constrains a change — but a note is a fact about the code, and
by the time an agent is editing it has already decided what to do. Told while it
is still working out what the file is, the fact can still change the plan.

`PreToolUse` now matches `Read` as well, and the asymmetry is deliberate:

- **reading** delivers notes, and nothing else. No rules, and **never a denial**
  — gating writes into an undecided path is the point; refusing to let anyone
  *look* at it would be a different tool.
- **writing** is unchanged: the gate, then the rules, then the notes.

It costs 55ms on each file an agent opens — around two seconds across a session
of forty reads, against turns measured in tens of seconds. Measured, not
estimated, and stated here because "it does not make Claude Code slower" is a
claim like any other.

### What the agent is told first

The brief in `AGENTS.md` and at `SessionStart` used to open with how to ask.
It opens with how to record now, because that is the thing an agent will do
several times a day, and asking is the thing it should do rarely:

> When this repo teaches you something that was not obvious from reading it —
> a second copy of a function, a footgun, a constraint you had to discover the
> hard way — write it down. It is the half you are best at: you cannot decide
> what the human likes, but nobody is better placed to say what just cost an
> hour.

That last sentence is the whole division of labour, and it took sixty findings
and five judged decisions to be able to write it honestly.

---

## The test that mattered

One sentence, in a session that had never seen the file:

> *The switch from focus to break feels abrupt. Make it smoother.*

That is the most transition-inviting request in web development. The file even
had a `transition: color 600ms ease` sitting in it, ready to be extended. And
this codebase has a trap: a note written two sessions earlier saying the fuse
ticks deliberately have **no** CSS transitions, because Chrome freezes
animation timelines in a background tab and a tick strands mid-colour.

The agent opened `index.html`. The note arrived on the read, before it planned.
Then it **deleted** the existing transition:

```diff
- .meta__phase{ color: var(--bright); transition: color 600ms ease; }
+ /* No colour transition: the phase swap happens mid-handover, while this is
+    faded out, so it fades back in already wearing the new colour. */
+ .meta__phase{ color: var(--bright); }
```

and built the entire 1.4-second handover in JavaScript on the render loop. Its
own words:

> *It's driven from JS on the render loop, not CSS. Your note on this file says
> an occluded tab freezes CSS timelines and strands ticks mid-transition — a
> stranded handover would leave an empty fuse and an invisible clock. Every
> value is recomputed from wall time each frame, so a tab that sleeps through
> the whole thing wakes up on the finished state. I verified that: sampling
> under a throttled tab, it landed clean.*

A fact learned in one session, by one agent, changed the architecture chosen by
a different agent two sessions later — and that agent then went and **verified
the constraint empirically** rather than taking the note's word for it.

That is the claim this whole tool rests on, and it is the first time there has
been evidence for it rather than an argument.

### What else the same run confirmed

**The durability guidance held.** Three live previews, `A-1.html B-2.html
C-3.html`, copied into the decision. Last time the agent left them on a
preview server that would die with its session; this time it wrote *"copied
into the decision so they work without a server"* unprompted.

**The blind test held.** No `(current)`, no *"I picked"* anywhere in the item.

**It wrote a new note, and it is the best one yet:**

> *previews/build.py patches index.html by literal string match… rename or
> reformat any of those and the preview silently comes out as plain index.html:
> it looks right, it just isn't the variant you meant to show, and you can waste
> a long time judging the wrong page. build() now raises on a missed hook
> instead of shrugging.*

An agent, in a project unrelated to stet, independently discovered the exact
failure class this log has recorded sixty times — *it looks right, it just
isn't* — and wrote it down for whoever comes next.

### And an accident worth keeping

It also said: *"Canon rule 2 ruled on it (warm figure — dark field, accent
numerals and rules)."*

Canon rule 2 reads **"i dont see a difference between abc so A it is"**. Useless
as an injected line — and the *decision underneath it* was still usable, because
the provenance records what was asked and what won. The rule text was noise; the
verdict was not.

Which is the argument for splitting them, arriving by itself: the valuable thing
was the recorded decision all along, and forcing every verdict to also produce a
binding sentence is what filled that canon with junk.

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
| 40 | reading the wiring table | `UserPromptSubmit` was implemented, dispatched and advertised — and never installed, so a verdict given mid-session bound tomorrow's agent instead of the one waiting for it |
| 41 | generating a slash command | `allowed-tools` was built from the resolved command, so a pinned install pre-approved every node process on the machine |
| 42 | re-wiring a pinned install | it recognised its own command files by sniffing for a string the pinned form does not contain, so it refused to update itself and left a stale command behind |
| 43 | **checking the other half** | `PostCompact` is not a Claude Code event. That hook never fired once, for anybody — and `stet claude status` called it verified, because it asked our own binary about our own argument names and never asked Claude Code what it emits |
| 44 | `git add .` | `.stet/` held 26 files: one canon worth sharing and 25 per-developer session journals, all of them committed |
| 46 | a stray `stet` in a terminal | the global install was `stetmark@0.4.0`, twenty-one releases behind — detected and worked around by the wiring every time, but answering from 0.4.0 to anyone who typed `stet` |
| 59 | **the first canon a stranger built** | the first-person check was a list of verbs, so "i love" and "i dont" went straight through, and "so A it is" missed the variant-label pattern — two of three junk rules were never even flagged |
| 60 | the same three rules | the third *was* flagged, and the reveal wrote it anyway: an empty sharpen box fell back to the original, so a screen saying "this will not work as a rule" injected exactly that on Enter |
| 57 | **an agent unblocking itself** | `stet undo` removes a pending decision, so a denied tool call can be un-denied by the thing it denied — and deleting it left no trace for the person it was addressed to |
| 58 | reading where the previews pointed | two decisions pointed at a preview server the agent started mid-session: when it stops they render blank, and a decision is supposed to wait for a human overnight |
| 55 | a screenshot of the real decision screen | with three variants the verdict bar bound `C` and `something else` to the same key — the handler was right and the label lied, leaving no key for "something else" at all |
| 56 | the same screenshot, once fixed | three live frames were 480px wide in 427px columns: aspect-ratio plus min-height and no width resolves height-first, and two variants were never narrow enough to show it |
| 54 | standing in the blocked project | a pending decision denies writes to every path it claims and had no way out — `undo` walked a decided item back, nothing walked a queued one away, so a bad question held a gate until you deleted a directory by hand |
| 52 | **a stranger's project, first real decision** | the blind test was voided by the item's own content — variant A said "(current)" and the question said "I picked warm apricot", so the shuffle protected nothing |
| 53 | the same decision | an accent colour asked as three hex codes: unjudgeable, in the one tool whose pitch is showing the real artifact |
| 51 | setting up a fresh project | `stet claude` printed "stet is now a gate in this repo" while the gate would not run until the next session — Claude Code snapshots hooks at startup, and nothing in three successful commands said so |
| 50 | **working under its own gate** | the instruction telling an agent to ask lived only in `AGENTS.md` — a file Claude Code is not documented to read, and which stet writes `CLAUDE.md` alongside only if one already exists. Everything else travelled on a hook proven to fire |
| 48 | a dead-export scan | `restatesOption` was exported and never called for two releases — written alongside a real fix and never wired, the same species as finding 40 |
| 49 | the fix for 47 | the guard asserted the checkout had *no* hook markers, which fails the moment a developer works in this repo under its own gate — it had to assert the suite *changed* none |
| 47 | wiring this repo under its own gate | `test/stress.mjs` fuzzed the hook CLI without a `cwd`, so forty hostile payloads fired hooks at the developer's own checkout — writing false evidence into the check built to be trustworthy |
| 45 | **writing a rule scoped to `**/*.test.*`** | every glob containing a full stop or `**/` was silently truncated or dropped by the provenance parser, so `package.json` became the glob `package` and `**/*.test.*` became no scope at all — for the life of the project, in the mechanism the whole tool is built on |

The pattern is consistent enough to be a rule: **the failures that matter are
invisible from the code and obvious from the use.** Eight of the thirty-nine
announced themselves — 5, 6, 7, 14, 24, 26, 31 and 39 — and they are the boring
kind: a hang, a non-zero exit, a warning printed before proceeding anyway. The
other fifty-two reported success while broken.

Finding 43 is the one to reread. Every safeguard behaved perfectly: the hook was
wired, the binary implemented it, the probe ran, the status was green, the README
described the behaviour, and a test covered the function. None of that could
detect that the event name did not exist, because every piece of it was written
by the same author checking their own work. The only thing that found it was
reading someone else's list.

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
