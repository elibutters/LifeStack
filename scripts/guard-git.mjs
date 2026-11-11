#!/usr/bin/env node
// Refuses git commands that disturb other agents' uncommitted work when run in the shared main folder.
// It is a hook for both Claude Code (.claude/settings.json, PreToolUse on Bash) and Cursor
// (.cursor/hooks.json, beforeShellExecution). Inside a linked worktree (.worktrees/<task>) everything is
// allowed, because the files there are the agent's own. To override on purpose, start the command with
// LS_ALLOW_SHARED_TREE=1. See CLAUDE.md, "Working with multiple agents".
import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// `git`, then any global options, then the subcommand pattern.
const git = (sub) => new RegExp(String.raw`\bgit(?:\s+(?:-C\s+\S+|-c\s+\S+|--[a-z-]+(?:=\S+)?|-p))*\s+${sub}`);
const REST = String.raw`[^;&|\n]*`;
const RULES = [
  [git(String.raw`stash\b(?!\s+(?:list|show)\b)`), "git stash moves everyone's uncommitted files out of the shared folder"],
  [git(String.raw`reset\b${REST}--hard`), "git reset --hard discards uncommitted work"],
  [git(String.raw`clean\b(?!${REST}(?:\s-n\b|--dry-run))`), "git clean deletes untracked files that may belong to another agent"],
  [git(String.raw`(?:checkout|switch)\b`), "switching branches or checking out files changes the shared folder under other agents"],
  [git(String.raw`restore\b(?!(?=${REST}--staged\b)(?!${REST}--worktree\b))`), "git restore overwrites uncommitted work"],
  [git(String.raw`add\b${REST}(?:\s-A\b|\s--all\b|\s\.(?:\s|$))`), "git add of everything would stage other agents' files; add files by name"],
];

// Returns the reason a command is refused, or null when it is fine.
export function verdict(command, inMainTree) {
  if (!inMainTree) return null;
  if (/^\s*(?:\S+=\S+\s+)*LS_ALLOW_SHARED_TREE=1\b/.test(command) || /\bLS_ALLOW_SHARED_TREE=1\s/.test(command)) return null;
  if (command.includes(".worktrees/")) return null; // working in (or cd-ing into) a worktree
  for (const [re, why] of RULES) if (re.test(command)) return why;
  return null;
}

const message = (why) =>
  `Blocked: ${why}. Other agents work in this folder. Do your work in your own worktree instead: ` +
  `bash scripts/new-worktree.sh <task>, then stay inside .worktrees/<task>. (Owner override: start the command with LS_ALLOW_SHARED_TREE=1.)`;

// True when `cwd` is the main working tree of a repository that uses this guard.
function isMainTreeOfThisRepo(cwd) {
  try {
    const run = (a) => execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const top = run(["rev-parse", "--show-toplevel"]);
    if (!existsSync(join(top, "scripts", "guard-git.mjs"))) return false; // some other repository
    const dir = realpathSync(resolve(cwd, run(["rev-parse", "--git-dir"])));
    const common = realpathSync(resolve(cwd, run(["rev-parse", "--git-common-dir"])));
    return dir === common;
  } catch { return false; }
}

async function main() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  let input = {};
  try { input = JSON.parse(raw || "{}"); } catch { /* unreadable input: allow */ }
  const claude = input.tool_input !== undefined; // Claude Code sends tool_input.command; Cursor sends command
  const command = String((claude ? input.tool_input?.command : input.command) ?? "");
  const cwd = String(input.cwd ?? process.cwd());
  const why = command ? verdict(command, isMainTreeOfThisRepo(cwd)) : null;
  if (claude) {
    if (why) { console.error(message(why)); process.exit(2); }
    return;
  }
  console.log(JSON.stringify(why ? { permission: "deny", user_message: message(why), agent_message: message(why) } : { permission: "allow" }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) await main();
