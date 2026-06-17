// Commit convention: Conventional Commits with ticket ID enforcement.
// See global CLAUDE.md. Ticket IDs use the VCT- prefix for this repo
// (feat/VCT-{n}-description branches, per PRD §13.3).

module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'refactor', 'chore', 'docs', 'style', 'perf', 'test', 'build', 'ci', 'revert'],
    ],
    'scope-case': [2, 'always', 'kebab-case'],
    'subject-case': [2, 'never', ['sentence-case', 'start-case', 'pascal-case', 'upper-case']],
    'subject-empty': [2, 'never'],
    'subject-full-stop': [2, 'never', '.'],
    'header-max-length': [2, 'always', 100],
    'body-max-line-length': [1, 'always', 100],
  },
};
