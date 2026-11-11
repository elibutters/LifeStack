// Run with `node scripts/guard-git.test.mjs` (also part of `pnpm test`). Pure: no git, no database.
import assert from "node:assert/strict";
import { verdict } from "./guard-git.mjs";

const denied = [
  "git stash", "git stash push -u -m x", "git stash pop", "git stash drop", "cd x && git stash",
  "git reset --hard", "git reset --hard origin/main", "git -C /repo reset --hard HEAD~1",
  "git clean -fd", "git clean -fdx",
  "git checkout main", "git checkout -b task origin/main", "git checkout -- apps/web/lib/goals.ts", "git switch -c task", "git switch main",
  "git restore apps/web/lib/goals.ts", "git restore --worktree --staged .",
  "git add -A", "git add .", "git add --all", "git add . && git commit -m x",
  "bash -c 'git stash'", "git -c core.quotepath=off stash",
];
for (const c of denied) assert.ok(verdict(c, true), `refuses in the main folder: ${c}`);
for (const c of denied) assert.equal(verdict(c, false), null, `allows in a worktree: ${c}`);

const fine = [
  "git status", "git diff", "git log --oneline", "git add apps/web/lib/goals.ts", "git commit -m \"Add a thing\"", "git push -u origin task",
  "git stash list", "git stash show -p", "git clean -n", "git clean --dry-run -fd", "git restore --staged apps/web/lib/goals.ts",
  "git fetch", "git pull --ff-only", "git worktree add .worktrees/x -b x origin/main", "git worktree remove .worktrees/x", "git branch -D task",
  "git diff --cached --stat", "git reset HEAD apps/web/lib/goals.ts", "git rebase origin/main", "pnpm test", "ls -la",
];
for (const c of fine) assert.equal(verdict(c, true), null, `allows in the main folder: ${c}`);

assert.equal(verdict("LS_ALLOW_SHARED_TREE=1 git stash", true), null, "the owner can override on purpose");
assert.equal(verdict("cd .worktrees/task && git stash", true), null, "a command that works inside a worktree is fine");
assert.ok(verdict("git checkout main", true).includes("shared"), "the reason says why");
console.log("guard-git tests passed");
