#!/usr/bin/env bash
# Keeps personal data and secrets out of the repo. See PRIVACY.md.
# Usage: check-privacy.sh              check staged changes (pre-commit)
#        check-privacy.sh --all        check every tracked file (CI)
#        check-privacy.sh --msg FILE   check a commit message (commit-msg)
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

corpus=$(mktemp)
trap 'rm -f "$corpus"' EXIT
files=""

case "${1:-}" in
  --all)
    files=$(git ls-files)
    # Every line of every tracked text file, prefixed with path:line.
    git ls-files -z | xargs -0 grep -InH '' -- > "$corpus" 2>/dev/null
    ;;
  --msg)
    grep -v '^#' "$2" > "$corpus"
    ;;
  *)
    files=$(git diff --cached --name-only --diff-filter=ACMR)
    { echo "$files"
      git diff --cached -U0 --diff-filter=ACMR | grep -E '^\+' | grep -vE '^\+\+\+ (b/|/dev/null)'
    } > "$corpus"
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

# 3. Database URLs: only a credential-free or local development URL may appear.
urls=$(grep -oiE 'postgres(ql)?(\+[a-z0-9]+)?://[^[:space:]"'"'"'`<>]+' "$corpus" | sort -u)
bad=$(echo "$urls" | grep -v '^$' \
  | grep -viE '^postgres(ql)?(\+[a-z0-9]+)?://([^@/?]*@)?(127\.0\.0\.1|localhost|host)([:/?].*)?$')
bad+=$(echo "$urls" | grep -iE '[?&]password=')
[[ -n "$bad" ]] && report "database connection string with a non-local host or embedded password"

# 4. The owner's own terms (name, email, employer, ...) from the untracked denylist.
#    Entries are case-insensitive extended regexes; escape . + ( ) and similar.
if [[ -f .privacy-denylist ]]; then
  while IFS= read -r pat || [[ -n "$pat" ]]; do
    [[ -z "$pat" || "$pat" == \#* ]] && continue
    hits=$(scan -i -e "$pat") || exit 2
    [[ -n "$hits" ]] && report "matches a .privacy-denylist entry (entry not shown)"
  done < .privacy-denylist
fi

[[ $fail -eq 0 ]] && echo "privacy check: ok"
exit $fail
