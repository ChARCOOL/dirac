#!/bin/bash
# check-architecture.sh — mechanical architecture guard (TECH-DEBT-PLAN item 0).
# Each check emits violations as "path:line:content"; the runner normalizes to
# "path:content", subtracts allow-listed exceptions, and diffs the rest against
# scripts/architecture-baseline.txt. A check fails only on NEW violations, so the
# script is green on master today and acts as a ratchet while debt items land.
set -uo pipefail
cd "$(dirname "$0")/.."

BASELINE_FILE="scripts/architecture-baseline.txt"
ALLOWLIST_FILE="scripts/architecture-allowlist.txt"
WRITE_BASELINE=0
[ "${1:-}" = "--write-baseline" ] && WRITE_BASELINE=1

# Exclude generated/dependency trees from every recursive grep (AGENTS.md rule).
EXCLUDES=(--exclude-dir=node_modules --exclude-dir=generated --exclude-dir=proto --exclude-dir=dist --exclude-dir=out --exclude-dir=build)

# --- check functions: print raw "path:line:content" (or "path") violations ----

check_cycle_task_controller() {
  # task must not know Controller exists; controller->task direction is legal
  grep -rEn 'from "(\.\./)+controller|from "@core/controller' "${EXCLUDES[@]}" --include='*.ts' src/core/task/ 2>/dev/null
}

check_no_vscode_in_core() {
  grep -rEn 'from "vscode"|require\("vscode"\)' "${EXCLUDES[@]}" --include='*.ts' src/core/ 2>/dev/null
}

check_leaf_services() {
  grep -rEn 'from "(@core/?|(\.\./)+core/?)' "${EXCLUDES[@]}" --include='*.ts' src/services/ 2>/dev/null
}

check_leaf_integrations() {
  grep -rEn 'from "(@core/?|(\.\./)+core/?)' "${EXCLUDES[@]}" --include='*.ts' src/integrations/ 2>/dev/null
}

check_tool_seal() {
  # production seal: modules/<a>/** may import tools infrastructure but never a
  # sibling module. Test files exempt — they instantiate tools under test.
  grep -rEn 'from "[^"]+"' "${EXCLUDES[@]}" --include='*.ts' src/core/task/tools/modules/ 2>/dev/null | \
    grep -v '__tests__\|\.test\.ts' | while IFS= read -r line; do
    file="${line%%:*}"
    mod_a=$(printf '%s' "$file" | sed -n 's|.*/modules/\([^/]*\)/.*|\1|p')
    [ -z "$mod_a" ] && continue
    spec=$(printf '%s' "$line" | sed -n 's/.*from "\([^"]*\)".*/\1/p')
    case "$spec" in
      *modules/*)
        # alias/absolute specifier naming a module directly
        mod_b=$(printf '%s' "$spec" | sed -n 's|.*modules/\([^/]*\).*|\1|p') ;;
      ../*|./*)
        # resolve relative specifier against the file's dir, collapsing x/../ pairs
        resolved=$(printf '%s' "$(dirname "$file")/$spec" | sed -e 's|/\./|/|g' -e ':a' -e 's|/[^/.][^/]*/\.\./|/|g' -e 'ta')
        mod_b=$(printf '%s' "$resolved" | sed -n 's|.*/modules/\([^/]*\)/.*|\1|p') ;;
      *) mod_b="" ;;
    esac
    if [ -n "$mod_b" ] && [ "$mod_b" != "$mod_a" ] && [ -d "src/core/task/tools/modules/$mod_b" ]; then
      printf '%s\n' "$line"
    fi
  done
}

check_one_tool_taxonomy() {
  # tool-set definitions live only in src/shared/tools.ts (plan item 4)
  grep -rEn 'export (const|function|class) (FILE_EDIT_TOOLS|FILE_SAVE_TOOLS|TOOL_DESCRIPTIONS|READ_ONLY_TOOLS|MUTATING_TOOLS)\b' \
    "${EXCLUDES[@]}" --include='*.ts' src/ cli/src/ 2>/dev/null | grep -v '^src/shared/tools\.ts:'
}

check_no_numeric_or_default() {
  # `x || <number>` silently converts 0/NaN to the default; use ?? (plan item 7)
  grep -rEn '\|\| [0-9]+' "${EXCLUDES[@]}" --include='*.ts' src/ 2>/dev/null | grep -v '__tests__\|\.test\.ts'
}

check_env_centralized() {
  # file-level check: which core files read process.env directly (plan item 8)
  grep -rln 'process\.env' "${EXCLUDES[@]}" --include='*.ts' src/core/ 2>/dev/null | grep -v '__tests__\|\.test\.ts'
}

check_webview_no_escape() {
  # webview must consume core only via generated proto types, not source imports
  grep -rEn 'from "[^"]+"' "${EXCLUDES[@]}" --include='*.ts' --include='*.tsx' webview-ui/src/ 2>/dev/null | \
    grep -E 'from "[^"]*src/(core|services|integrations|hosts)/|from "@core/'
}

check_any_ratchet() {
  # diff-based, zero-tolerance: new `as any` / `: any` added in src code fails
  local base
  base=$(git merge-base HEAD origin/master 2>/dev/null || git merge-base HEAD master 2>/dev/null || true)
  [ -z "$base" ] && return 0
  git diff -U0 "$base" -- src cli/src webview-ui/src 2>/dev/null | \
    awk '/^\+\+\+ b\// { file = substr($0, 7); next }
         /^\+/ && ($0 ~ /as any([^A-Za-z0-9_]|$)/ || $0 ~ /: *any([,;)> ]|$)/) {
           if (file !~ /\.test\.|__tests__/) print file ":" substr($0, 2)
         }'
}

# --- runner -----------------------------------------------------------------

CHECKS="check_cycle_task_controller check_no_vscode_in_core check_leaf_services check_leaf_integrations check_tool_seal check_one_tool_taxonomy check_no_numeric_or_default check_env_centralized check_webview_no_escape check_any_ratchet"

TMPD=$(mktemp -d); trap 'rm -rf "$TMPD"' EXIT
FAILED=""

for id in $CHECKS; do
  "$id" > "$TMPD/raw" 2>/dev/null || true
  # normalize path:line:content -> path:content (line numbers are unstable)
  sed -E 's/^([^:[:space:]]+):[0-9]+:[[:space:]]*/\1:/' "$TMPD/raw" | sed 's/[[:space:]]*$//' | sort -u > "$TMPD/norm"
  # subtract allow-listed exceptions (substring match)
  awk -F'\t' -v id="$id" '$1==id {print $2}' "$ALLOWLIST_FILE" 2>/dev/null > "$TMPD/allowed" || true
  if [ -s "$TMPD/allowed" ]; then
    grep -Fvf "$TMPD/allowed" "$TMPD/norm" > "$TMPD/active" || true
  else
    cp "$TMPD/norm" "$TMPD/active"
  fi

  if [ "$WRITE_BASELINE" = 1 ]; then
    awk -v id="$id" '{print id "\t" $0}' "$TMPD/active" >> "$TMPD/newbaseline"
    continue
  fi

  awk -F'\t' -v id="$id" '$1==id {print $2}' "$BASELINE_FILE" 2>/dev/null | sort -u > "$TMPD/base"
  new=$(comm -23 "$TMPD/active" "$TMPD/base" | wc -l | tr -d ' ')
  fixed=$(comm -13 "$TMPD/active" "$TMPD/base" | wc -l | tr -d ' ')
  total=$(wc -l < "$TMPD/active" | tr -d ' ')

  if [ "$new" -gt 0 ]; then
    FAILED="$FAILED $id"
    echo "[FAIL] $id — $new NEW violation(s) (baseline: $((total - new)) known)"
    comm -23 "$TMPD/active" "$TMPD/base" | sed 's/^/       + /'
  else
    echo "[PASS] $id — $total known-debt violation(s), 0 new"
  fi
  [ "$fixed" -gt 0 ] && echo "       ↳ $fixed baseline entr(ies) resolved — rerun with --write-baseline"
done

if [ "$WRITE_BASELINE" = 1 ]; then
  printf '# check_id\tpath:content — known-debt violations; shrink to zero as items land\n' > "$BASELINE_FILE"
  sort "$TMPD/newbaseline" >> "$BASELINE_FILE" 2>/dev/null || true
  echo "wrote $BASELINE_FILE ($(($(wc -l < "$BASELINE_FILE") - 1)) entries)"
  exit 0
fi

echo
if [ -n "$FAILED" ]; then
  echo "architecture guard FAILED:$FAILED"
  exit 1
fi
echo "architecture guard passed (no new violations)"
