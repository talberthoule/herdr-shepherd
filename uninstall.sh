#!/bin/sh
set -eu

purge_audit_history=0
[ "${1:-}" = "--purge-audit-history" ] && purge_audit_history=1

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
skill_root="$repo_root/skills/herdr-shepherd"
codex_home="${CODEX_HOME:-$HOME/.codex}"
claude_home="$HOME/.claude"
codex_hooks="$codex_home/hooks.json"
claude_settings="$claude_home/settings.json"
claude_link="$claude_home/skills/herdr-shepherd"
state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/Herdr/coordination-audit"

codex_arg="-"
claude_arg="-"
command -v codex >/dev/null 2>&1 && codex_arg="$codex_hooks"
command -v claude >/dev/null 2>&1 && claude_arg="$claude_settings"

node "$skill_root/scripts/configure-hooks.mjs" uninstall "$codex_arg" "$claude_arg" "$skill_root"

if [ -L "$claude_link" ] && [ "$(readlink "$claude_link")" = "$skill_root" ]; then
  rm "$claude_link"
elif [ -e "$claude_link" ]; then
  echo "Preserved unexpected Claude skill path: $claude_link" >&2
fi

rm -f "$state_dir/viewer.json"
if [ "$purge_audit_history" -eq 1 ] && [ -d "$state_dir" ]; then
  expected="${XDG_STATE_HOME:-$HOME/.local/state}/Herdr/coordination-audit"
  [ "$state_dir" = "$expected" ] || { echo "Refusing to purge unexpected path: $state_dir" >&2; exit 1; }
  rm -rf "$state_dir"
fi

echo "Removed Herdr coordination hooks."
[ "$purge_audit_history" -eq 0 ] && echo "Preserved audit history at $state_dir"
