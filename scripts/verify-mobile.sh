#!/usr/bin/env bash
#
# THE GATE THAT RUNS WHETHER OR NOT ANYONE REMEMBERS TO RUN IT.
#
# hadar, 2026-09-23: the recurring cost in this repo is not hard bugs — it is
# changes declared done that were never checked, so the human becomes the QA loop
# and finds out by watching a screen go blank. `apps/mobile/package.json` has
# carried `typecheck`, `test` and `lint:hooks` for months. Nothing ever forced
# them, and a convention honoured only when someone remembers is worth nothing
# exactly when code volume rises.
#
# Wired as a Stop hook in .claude/settings.json, so it runs when an assistant
# tries to END A TURN: a non-zero exit hands the failures back to it to fix
# rather than to you to discover. Run it by hand any time: scripts/verify-mobile.sh
#
# WHAT IT CANNOT DO, stated so it is never mistaken for proof: these are static
# and unit gates. They catch type errors, broken hook dependencies and logic
# regressions. They do NOT render a screen — so a layout or animation defect (a
# view translated off the edge of the phone, a transition that uncovers an empty
# page) passes all three cleanly. Device checks are still device checks.
set -uo pipefail

# Resolved from git, never from $0 or the cwd: a hook is invoked with whatever
# directory the session happens to be sitting in, and a relative guess lands in
# apps/mobile/apps/ and silently PASSES — the one failure mode a gate must not
# have. Outside a checkout there is nothing to guard, so stand down.
ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$ROOT" || exit 0

# Nothing touched in the app? Nothing to verify. Keeps the gate off the turns
# that only moved docs, SQL, or the website.
if git diff --quiet HEAD -- apps/mobile 2>/dev/null && \
   [ -z "$(git ls-files --others --exclude-standard apps/mobile)" ]; then
  exit 0
fi

# A fingerprint of the app's uncommitted state. Two jobs, both load-bearing:
#   1. Already green for exactly this tree? Answer in a millisecond. Without it
#      the gate re-runs its 24 seconds on every conversational turn for as long
#      as the app has uncommitted work — which is most of the time, and is how a
#      useful gate becomes one somebody switches off.
#   2. A Stop hook is RE-ENTRANT: the assistant fixes what we reported, tries to
#      stop, and we fire again. That is the point — but if it cannot fix the
#      thing, the loop never ends. Three failures on an UNCHANGED tree means it
#      is stuck, so we stand aside and let a human look.
STATE="$ROOT/.git/verify-mobile-state"
NOW=$(git diff HEAD -- apps/mobile | shasum | cut -d' ' -f1)
PREV=$(cut -d' ' -f1 "$STATE" 2>/dev/null || echo none)
TRIES=$(cut -d' ' -f2 "$STATE" 2>/dev/null || echo 0)
[ "$PREV" = "$NOW" ] && [ "$TRIES" = "ok" ] && exit 0
if [ "$PREV" = "$NOW" ] && [ "$TRIES" -ge 3 ] 2>/dev/null; then
  echo "verify-mobile: still failing after $TRIES attempts on an unchanged tree — standing aside." >&2
  exit 0
fi

cd "$ROOT/apps/mobile" || exit 0
out=$(mktemp -d)
# In parallel: ~35s serial, ~24s together, and the three are independent.
npm run --silent typecheck  > "$out/typecheck" 2>&1 & p1=$!
npm run --silent lint:hooks > "$out/hooks"     2>&1 & p2=$!
npm run --silent test       > "$out/test"      2>&1 & p3=$!
wait $p1; r1=$?
wait $p2; r2=$?
wait $p3; r3=$?

fail=0
report() { echo "── $1 FAILED ──" >&2; tail -40 "$2" >&2; fail=1; }
[ $r1 -ne 0 ] && report "apps/mobile typecheck"  "$out/typecheck"
[ $r2 -ne 0 ] && report "apps/mobile lint:hooks" "$out/hooks"
[ $r3 -ne 0 ] && report "apps/mobile tests"      "$out/test"
rm -rf "$out"

if [ $fail -ne 0 ]; then
  if [ "$PREV" = "$NOW" ]; then echo "$NOW $((TRIES + 1))" > "$STATE"; else echo "$NOW 1" > "$STATE"; fi
  echo "" >&2
  echo "Fix these before reporting the work done. (scripts/verify-mobile.sh)" >&2
  exit 2
fi
echo "$NOW ok" > "$STATE"
exit 0
