# Rules

Earned one at a time, by a human, in this repository.
Each rule is binding on every agent that touches this repo.

## 1 — the sharpen field takes focus the moment the reveal lands

*Earned from reveal-timing, 2026-08-05. Tags: ui. Globs: src/page.ts.*

Asked: "When the reveal lands, should the sharpen field steal focus?" — chose A over B.

## 2 — reproduce a reported failure before changing anything, and say plainly when it does not reproduce

*Earned from a correction, 2026-08-06. Tags: method.*

Earned from an outside bug report of seven claims, one of which was wrong.
Reproducing first cost minutes and prevented a change with no bug under it.
A report from a real session is evidence, not a verdict.

## 3 — a green signal is not evidence — look at the artifact a person would actually touch

*Earned from a correction, 2026-08-06. Tags: method.*

Thirty-six of forty-four findings in this project reported success while
broken: a capture with the right dimensions and the wrong picture, two live
previews that rendered blank, a hook that fired and gated nothing, a
published package that identified itself as the previous version.

## 4 — test the artifact you ship, not the tree you built it in

*Earned from a correction, 2026-08-06. Tags: method, release. Globs: package.json, .github/workflows/**, Dockerfile, Makefile.*

Ninety-four passing tests and three stress suites could not see five bugs
that a stranger hit in their first three commands, because every one of
those checks ran against src/ and nobody had ever installed the tarball.

## 5 — verify against the other side's list, never against your own names

*Earned from a correction, 2026-08-06. Tags: method.*

stet wired a hook called PostCompact for its entire life. No such event
exists. The status check asked our own binary whether it implemented
post-compact — it did — and reported "verified". Both halves of that
conversation had the same author, so it could only agree with itself.

## 6 — keep the reproduction as a permanent check, not only the fix

*Earned from a correction, 2026-08-06. Tags: method. Globs: test/**, tests/**, **/*.test.*, **/*.spec.*.*

Every finding here that stayed fixed became a check that runs before
release. The one bug that came back — a check-then-watch race — came back
in the harness guarding the release, written by the person who had closed
it two releases earlier.

## 7 — a warning that fires on correct input trains people to ignore warnings

*Earned from a correction, 2026-08-06. Tags: method.*

The first draft of a check meant to stop questions becoming rules also
rejected "do not centre the hero" and "when the list is empty, say what to
do next". An earlier warning that fired too easily was clicked past twice
by the tool's own author, which made it a design failure and not a user one.

## 8 — never infer identity from content that varies — write an explicit marker

*Earned from a correction, 2026-08-06. Tags: method.*

A generated file recognised its own work by searching the body for "stet
status". The pinned form says ".../stet.js status", so it declined to
update its own file and left a stale one behind.

## 9 — when the same logic lives in two places, change both and add a check that they agree

*Earned from a correction, 2026-08-06. Tags: method.*

The rule-quality check exists twice: once in the library and once inside
the page document, which has no imports. Fixing one left the warning silent
in the only place a human would ever see it, with every test passing.
