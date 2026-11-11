# Agent instructions

Read `CLAUDE.md` first; it applies to every agent (Claude Code, Cursor, anything else). The rules that
matter most when several agents are working at once:

- Work only in your own worktree: `bash scripts/new-worktree.sh <task>`, then stay inside
  `.worktrees/<task>`. Never work in the main folder.
- In the main folder never stash, reset --hard, clean, checkout -- <path>, restore, or switch branches.
- No personal information anywhere in this public repo (`PRIVACY.md`).
- Never run tests against any database except the throwaway `lifestack_test` (`pnpm test` does this).
