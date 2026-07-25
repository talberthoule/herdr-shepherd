#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
skill_root="$repo_root/skills/herdr-shepherd"
codex_home="${CODEX_HOME:-$HOME/.codex}"
claude_home="$HOME/.claude"
codex_hooks="$codex_home/hooks.json"
claude_settings="$claude_home/settings.json"
claude_link="$claude_home/skills/herdr-shepherd"
state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/Herdr/coordination-audit"

command -v node >/dev/null 2>&1 || { echo "Required command is not available on PATH: node" >&2; exit 1; }
command -v herdr >/dev/null 2>&1 || { echo "Required command is not available on PATH: herdr" >&2; exit 1; }

codex_installed=0
claude_installed=0
command -v codex >/dev/null 2>&1 && codex_installed=1
command -v claude >/dev/null 2>&1 && claude_installed=1
if [ "$codex_installed" -eq 0 ] && [ "$claude_installed" -eq 0 ]; then
  echo "Neither Codex nor Claude Code is available on PATH." >&2
  exit 1
fi

mkdir -p "$codex_home" "$claude_home/skills" "$state_dir"
codex_arg="-"
claude_arg="-"
[ "$codex_installed" -eq 1 ] && codex_arg="$codex_hooks"
[ "$claude_installed" -eq 1 ] && claude_arg="$claude_settings"

node "$skill_root/scripts/configure-hooks.mjs" install "$codex_arg" "$claude_arg" "$skill_root"

if [ "$claude_installed" -eq 1 ]; then
  if [ -L "$claude_link" ]; then
    target=$(readlink "$claude_link")
    [ "$target" = "$skill_root" ] || { echo "Claude skill path already exists and is not the expected symlink: $claude_link" >&2; exit 1; }
  elif [ -e "$claude_link" ]; then
    echo "Claude skill path already exists and is not the expected symlink: $claude_link" >&2
    exit 1
  else
    ln -s "$skill_root" "$claude_link"
  fi
fi

if [ "$codex_installed" -eq 1 ] && { [ ! -f "$codex_home/config.toml" ] || ! grep -Eq '^[[:space:]]*hooks[[:space:]]*=[[:space:]]*true[[:space:]]*$' "$codex_home/config.toml"; }; then
  echo "Warning: Codex hooks are not enabled in config.toml. Add hooks = true under [features]." >&2
fi

echo "Installed herdr-shepherd."
echo "Shared audit state: $state_dir"
echo "Review and trust the new hooks in a fresh host session."
