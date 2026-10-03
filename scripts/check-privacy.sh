#!/usr/bin/env bash
# Keeps personal data and secrets out of the repo. See PRIVACY.md.
# Usage: check-privacy.sh           check staged changes (pre-commit)
#        check-privacy.sh --all     check every tracked file (CI)
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

if [[ "${1:-}" == "--all" ]]; then
  files=$(git ls-files)
  content() { git ls-files -z | xargs -0 grep -InHE ${2:-} -e "$1" -- 2>/dev/null || true; }
else
  files=$(git diff --cached --name-only --diff-filter=ACMR)
  content() { git diff --cached -U0 --diff-filter=ACMR | grep -E '^\+[^+]' | grep -InE ${2:-} -e "$1" || true; }
fi

fail=0
report() { echo "privacy check: $1" >&2; fail=1; }

# 1. File types that hold data or secrets rather than code.
bad=$(echo "$files" | grep -E '(^|/)\.env($|\.)|(^|/)local/|(^|/)backups/|\.(dump|csv|age|pem|key|sqlite|db)$|\.sql\.gz$' \
  | grep -vE '(^|/)\.env\.example$' || true)
[[ -n "$bad" ]] && report "data or secret files must not be committed:"$'\n'"$bad"

# 2. Common secret shapes.
secrets='-----BEGIN [A-Z ]*PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|ya29\.[A-Za-z0-9_-]{20,}|tskey-[a-z]+-[A-Za-z0-9]{10,}|xox[baprs]-[A-Za-z0-9-]{10,}'
hits=$(content "$secrets")
[[ -n "$hits" ]] && report "possible secret:"$'\n'"$hits"

# 3. Database URLs pointing anywhere but a local dev database, and private hostnames.
hits=$(content 'postgres(ql)?://[^[:space:]"]+@[^[:space:]"/:]+' | grep -vE '@(127\.0\.0\.1|localhost|postgres|HOST|host)([:/"]|$)' || true)
[[ -n "$hits" ]] && report "database connection string:"$'\n'"$hits"
hits=$(content '[a-z0-9-]+\.[a-z0-9-]+\.ts\.net')
[[ -n "$hits" ]] && report "tailnet hostname:"$'\n'"$hits"

# 4. The owner's own terms (name, email, employer, ...) from the untracked denylist.
if [[ -f .privacy-denylist ]]; then
  while IFS= read -r pat; do
    [[ -z "$pat" || "$pat" == \#* ]] && continue
    hits=$(content "$pat" -i)
    [[ -n "$hits" ]] && report "matches a .privacy-denylist entry (entry not shown)"
  done < .privacy-denylist
fi

[[ $fail -eq 0 ]] && echo "privacy check: ok"
exit $fail
