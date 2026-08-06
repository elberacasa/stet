---
allowed-tools: Bash(stet:*)
description: Take back the last verdict, and the rule it earned
---
<!-- written by stet · safe to delete · `stet claude remove` -->

The canon as it stands:

!`stet rules`

The user wants to take back a verdict — usually because the rule it produced is
not a rule, or the decision was wrong to have asked.

Run `stet undo` for the most recent one, or `stet undo <id>` if they
name a decision. To drop a rule without touching a decision, run
`stet rule remove <n>`.

Then say what was removed and what the canon says now. If the decision went
back in the queue, mention that judging it again will not be blind, because
they have already seen the reveal.
