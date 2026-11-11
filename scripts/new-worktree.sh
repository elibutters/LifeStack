#!/usr/bin/env bash
# Starts a task in its own worktree so agents never share a working tree. See CLAUDE.md.
# Usage: bash scripts/new-worktree.sh <task-name>
set -euo pipefail
task="${1:-}"
[[ "$task" =~ ^[a-z0-9][a-z0-9._-]*$ ]] || { echo "usage: new-worktree.sh <task-name> (lowercase letters, digits, - . _)" >&2; exit 2; }
# Always anchor on the main folder, even when run from inside another worktree.
main="$(cd "$(git rev-parse --git-common-dir)/.." && pwd)"
cd "$main"
dir=".worktrees/$task"
[[ ! -e "$dir" ]] || { echo "$dir already exists" >&2; exit 1; }
git fetch -q origin
git worktree add "$dir" -b "$task" origin/main
# Gitignored local files are shared by link, so a secret is never copied around. The privacy denylist must be
# linked too: without it the pre-commit privacy check silently skips the owner's own terms.
for f in .env .privacy-denylist; do
  [[ -f "$main/$f" ]] && ln -s "$main/$f" "$dir/$f"
done
(cd "$dir" && pnpm install --frozen-lockfile --prefer-offline >/dev/null)
echo "Ready: $main/$dir (branch $task). Work only inside it."
