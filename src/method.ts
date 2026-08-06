// The method canon.
//
// stet exists because human judgment does not compound. Neither does hard-won
// method: every one of these was learned by shipping the opposite, and none of
// them survived in anybody's head — they survived because they were written
// down and made binding.
//
// These are not opinions about how to write software. Each one is the rule that
// would have prevented a specific, recorded failure in stet's own build log,
// and the note on each says which. Forty-four findings; thirty-six of them
// reported success while broken. That is the shape of the problem an agent has,
// and it is not fixed by being careful.
//
// Installed only when asked (`stet method`), because a canon is a claim about
// what a repository believes, and putting claims in it that its owner never
// made is exactly what this tool refuses to do everywhere else.

export interface MethodRule {
  text: string;
  globs?: string[];
  tags?: string[];
  /** The finding this was earned from. Written into the rule's body. */
  note: string;
}

export const METHOD: MethodRule[] = [
  {
    text: 'reproduce a reported failure before changing anything, and say plainly when it does not reproduce',
    tags: ['method'],
    note:
      'Earned from an outside bug report of seven claims, one of which was wrong.\n' +
      'Reproducing first cost minutes and prevented a change with no bug under it.\n' +
      'A report from a real session is evidence, not a verdict.',
  },
  {
    text: 'a green signal is not evidence — look at the artifact a person would actually touch',
    tags: ['method'],
    note:
      'Thirty-six of forty-four findings in this project reported success while\n' +
      'broken: a capture with the right dimensions and the wrong picture, two live\n' +
      'previews that rendered blank, a hook that fired and gated nothing, a\n' +
      'published package that identified itself as the previous version.',
  },
  {
    text: 'test the artifact you ship, not the tree you built it in',
    globs: ['package.json', '.github/workflows/**', 'Dockerfile', 'Makefile'],
    tags: ['method', 'release'],
    note:
      'Ninety-four passing tests and three stress suites could not see five bugs\n' +
      'that a stranger hit in their first three commands, because every one of\n' +
      'those checks ran against src/ and nobody had ever installed the tarball.',
  },
  {
    text: 'verify against the other side\'s list, never against your own names',
    tags: ['method'],
    note:
      'stet wired a hook called PostCompact for its entire life. No such event\n' +
      'exists. The status check asked our own binary whether it implemented\n' +
      'post-compact — it did — and reported "verified". Both halves of that\n' +
      'conversation had the same author, so it could only agree with itself.',
  },
  {
    text: 'keep the reproduction as a permanent check, not only the fix',
    globs: ['test/**', 'tests/**', '**/*.test.*', '**/*.spec.*'],
    tags: ['method'],
    note:
      'Every finding here that stayed fixed became a check that runs before\n' +
      'release. The one bug that came back — a check-then-watch race — came back\n' +
      'in the harness guarding the release, written by the person who had closed\n' +
      'it two releases earlier.',
  },
  {
    text: 'a warning that fires on correct input trains people to ignore warnings',
    tags: ['method'],
    note:
      'The first draft of a check meant to stop questions becoming rules also\n' +
      'rejected "do not centre the hero" and "when the list is empty, say what to\n' +
      'do next". An earlier warning that fired too easily was clicked past twice\n' +
      'by the tool\'s own author, which made it a design failure and not a user one.',
  },
  {
    text: 'never infer identity from content that varies — write an explicit marker',
    tags: ['method'],
    note:
      'A generated file recognised its own work by searching the body for "stet\n' +
      'status". The pinned form says ".../stet.js status", so it declined to\n' +
      'update its own file and left a stale one behind.',
  },
  {
    text: 'when the same logic lives in two places, change both and add a check that they agree',
    tags: ['method'],
    note:
      'The rule-quality check exists twice: once in the library and once inside\n' +
      'the page document, which has no imports. Fixing one left the warning silent\n' +
      'in the only place a human would ever see it, with every test passing.',
  },
];
