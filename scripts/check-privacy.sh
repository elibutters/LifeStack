#!/usr/bin/env bash
# Keeps personal data and secrets out of the repo. See PRIVACY.md.
# Usage: check-privacy.sh              check staged changes (pre-commit)
#        check-privacy.sh --all        check every tracked file (CI)
#        check-privacy.sh --msg FILE   check a commit message (commit-msg)
set -uo pipefail
top=$(git rev-parse --show-toplevel) || exit 2
cd "$top" || exit 2

corpus=$(mktemp) || exit 2
trap 'rm -f "$corpus"' EXIT
files=""

# Any git failure aborts: an empty corpus must never read as a clean result.
case "${1:-}" in
  --all)
    files=$(git ls-files) || exit 2
    [[ -n "$files" ]] || { echo "privacy check: no tracked files found" >&2; exit 2; }
    # Every path, then every line of every tracked text file prefixed with path:line.
    { echo "$files"; git ls-files -z | xargs -0 grep -InH '' -- 2>/dev/null; } > "$corpus"
    ;;
  --msg)
    [[ -f "${2:-}" ]] || exit 2
    grep -v '^#' "$2" > "$corpus"
    ;;
  *)
    files=$(git diff --cached --name-only --diff-filter=ACMR) || exit 2
    diff=$(git diff --cached --no-color --no-ext-diff --no-textconv -U0 --diff-filter=ACMR) || exit 2
    { echo "$files"; echo "$diff" | grep -E '^\+' | grep -vE '^\+\+\+ (b/|/dev/null)'; } > "$corpus"
    ;;
esac

fail=0
report() { echo "privacy check: $1" >&2; fail=1; }

# grep the corpus; a pattern grep cannot compile is an error, never a silent pass.
scan() {
  local out rc
  out=$(grep -nE "$@" "$corpus")
  rc=$?
  if [[ $rc -gt 1 ]]; then
    echo "privacy check: invalid pattern, refusing to continue" >&2
    exit 2
  fi
  printf '%s' "$out"
}

# 1. File types that hold data or secrets rather than code.
bad=$(echo "$files" | grep -E '(^|/)\.env($|\.)|(^|/)local/|(^|/)backups/|\.(dump|csv|age|pem|key|sqlite|db)$|\.sql\.gz$' \
  | grep -vE '(^|/)\.env\.example$')
[[ -n "$bad" ]] && report "data or secret files must not be committed:"$'\n'"$bad"

# 2. Common secret shapes.
secrets='-----BEGIN [A-Z ]*PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|ya29\.[A-Za-z0-9_-]{20,}|tskey-[a-z]+-[A-Za-z0-9]{10,}|xox[baprs]-[A-Za-z0-9-]{10,}|npg_[A-Za-z0-9]{10,}|eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}'
hits=$(scan -e "$secrets") || exit 2
[[ -n "$hits" ]] && report "possible secret:"$'\n'"$hits"

# 3. Connection strings: only a local development URL may appear, and no URL of any
#    scheme may carry a password for a non-local host.
local_host='(127\.0\.0\.1|localhost|host)(:[0-9]+)?([/?].*)?$'
urls=$(grep -oiE '[a-z][a-z0-9+.-]*://[^[:space:]"'"'"'`<>]+' "$corpus" | sort -u)
bad=$(echo "$urls" | grep -iE '^postgres(ql)?(\+[a-z0-9]+)?://' \
  | grep -viE "^[a-z0-9+.-]+://([^@/?]*@)?$local_host")
bad+=$(echo "$urls" | grep -E '^[A-Za-z0-9+.-]+://[^/@[:space:]]*:[^/@[:space:]]+@' \
  | grep -viE "^[a-z0-9+.-]+://[^@/?]*@$local_host")
bad+=$(echo "$urls" | grep -iE '[?&]password=')
bad+=$(scan -i -e 'host=[a-z0-9.-]+[[:space:]].*password=[a-z0-9]') || exit 2
[[ -n "$bad" ]] && report "connection string with a non-local host or embedded password (not shown)"

# 4. The owner's own terms (name, email, employer, ...) from the untracked denylist.
#    Entries are case-insensitive extended regexes; escape . + ( ) and similar.
if [[ -f .privacy-denylist ]]; then
  while IFS= read -r pat || [[ -n "$pat" ]]; do
    pat=${pat%$'\r'}
    [[ -z "$pat" || "$pat" == \#* ]] && continue
    hits=$(scan -i -e "$pat") || exit 2
    [[ -n "$hits" ]] && report "matches a .privacy-denylist entry (entry not shown)"
  done < .privacy-denylist
fi

[[ $fail -eq 0 ]] && echo "privacy check: ok"
exit $fail
