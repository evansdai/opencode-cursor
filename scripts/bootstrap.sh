#!/usr/bin/env bash
# Bootstrap a local opencode-cursor fork for OpenCode (Linux, macOS, Git Bash/WSL on Windows).
#
# Usage (from fork clone root):
#   ./scripts/bootstrap.sh
#
# One-liner after clone:
#   git clone <your-fork-url> opencode-cursor && cd opencode-cursor && ./scripts/bootstrap.sh
#
# What it does:
#   1. Builds dist/plugin-entry.js (bun install && bun run build)
#   2. Writes ~/.config/opencode/.opencode-cursor-fork with this repo's absolute path
#   3. Installs a portable plugin wrapper at ~/.config/opencode/plugin/cursor-acp.js
#   4. Ensures cursor-acp provider exists in opencode.json (removes bare "cursor-acp" plugin entry)
#
# OPEN_CURSOR_DIR is optional after bootstrap. It overrides the registry for edge cases only.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
FORK_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
MARKER_FILE="$FORK_ROOT/.opencode-cursor-fork"
WRAPPER_TEMPLATE="$SCRIPT_DIR/templates/cursor-acp-plugin-wrapper.js"

log() { printf '%s\n' "$*"; }
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: ./scripts/bootstrap.sh [options]

Bootstrap this fork for OpenCode. Clone anywhere; no fixed ~/Documents path required.

Options:
  --check-only          Verify build + registry + wrapper; do not modify files
  --skip-build          Skip bun install / build (dist must already exist)
  --skip-models         Skip model sync after config update
  --config PATH         opencode.json path (default: ~/.config/opencode/opencode.json)
  --no-provider         Only build + registry + wrapper; do not touch opencode.json

Environment (all optional):
  OPEN_CURSOR_DIR       Override fork root (default: parent of scripts/)
  XDG_CONFIG_HOME       Config root (default: ~/.config)
  OPENCODE_CONFIG       Same as --config when set

After bootstrap, restart OpenCode. You do not need OPEN_CURSOR_DIR unless you move the fork.
EOF
}

get_config_home() {
  if [[ -n "${XDG_CONFIG_HOME:-}" ]]; then
    printf '%s' "$XDG_CONFIG_HOME"
  else
    printf '%s/.config' "$HOME"
  fi
}

CHECK_ONLY=0
SKIP_BUILD=0
SKIP_MODELS=0
NO_PROVIDER=0
CONFIG_PATH=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --check-only) CHECK_ONLY=1; shift ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    --skip-models) SKIP_MODELS=1; shift ;;
    --no-provider) NO_PROVIDER=1; shift ;;
    --config)
      [[ $# -ge 2 ]] || die "--config requires a path"
      CONFIG_PATH="$2"
      shift 2
      ;;
    *)
      die "Unknown option: $1 (try --help)"
      ;;
  esac
done

CONFIG_HOME="$(get_config_home)"
OPENCODE_DIR="$CONFIG_HOME/opencode"
REGISTRY_FILE="$OPENCODE_DIR/.opencode-cursor-fork"
PLUGIN_PATH="$OPENCODE_DIR/plugin/cursor-acp.js"
CONFIG_PATH="${CONFIG_PATH:-${OPENCODE_CONFIG:-$OPENCODE_DIR/opencode.json}}"

FORK_ROOT="${OPEN_CURSOR_DIR:-$FORK_ROOT}"
FORK_ROOT="$(cd -- "$FORK_ROOT" && pwd)"
ENTRY="$FORK_ROOT/dist/plugin-entry.js"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

write_marker_and_registry() {
  printf '%s\n' "$FORK_ROOT" >"$MARKER_FILE"
  mkdir -p "$OPENCODE_DIR"
  printf '%s\n' "$FORK_ROOT" >"$REGISTRY_FILE"
}

install_wrapper() {
  [[ -f "$WRAPPER_TEMPLATE" ]] || die "Missing wrapper template: $WRAPPER_TEMPLATE"
  mkdir -p "$(dirname "$PLUGIN_PATH")"
  cp "$WRAPPER_TEMPLATE" "$PLUGIN_PATH"
}

ensure_opencode_json() {
  [[ "$NO_PROVIDER" -eq 1 ]] && return 0

  mkdir -p "$(dirname "$CONFIG_PATH")"
  if [[ ! -f "$CONFIG_PATH" ]]; then
    printf '%s\n' '{"plugin":[],"provider":{}}' >"$CONFIG_PATH"
  fi

  if ! command -v bun >/dev/null 2>&1; then
    log "Note: bun not found; skipping opencode.json update."
    log "      Add ./plugin/cursor-acp.js and cursor-acp provider manually."
    return 0
  fi

  local removed_legacy=0
  removed_legacy="$(bun -e "
    const fs = require('fs');
    const configPath = process.argv[1];
    const baseUrl = 'http://127.0.0.1:32124/v1';
    const pluginRef = './plugin/cursor-acp.js';
    let config = {};
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (error) {
      console.error('Failed to parse opencode.json:', error.message);
      process.exit(1);
    }
    config.plugin = Array.isArray(config.plugin) ? config.plugin : [];
    const beforeLen = config.plugin.length;
    config.plugin = config.plugin.filter((entry) => entry !== 'cursor-acp');
    const removedLegacy = beforeLen - config.plugin.length;
    if (!config.plugin.includes(pluginRef)) {
      config.plugin.push(pluginRef);
    }
    config.provider = config.provider && typeof config.provider === 'object' ? config.provider : {};
    const current = config.provider['cursor-acp'] && typeof config.provider['cursor-acp'] === 'object'
      ? config.provider['cursor-acp']
      : {};
    const options = current.options && typeof current.options === 'object' ? current.options : {};
    const models = current.models && typeof current.models === 'object' ? current.models : {};
    config.provider['cursor-acp'] = {
      ...current,
      name: current.name || 'Cursor',
      npm: '@ai-sdk/openai-compatible',
      options: { ...options, baseURL: options.baseURL || baseUrl },
      models,
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    process.stdout.write(String(removedLegacy));
  " "$CONFIG_PATH" 2>&1)" || {
    log "Warning: failed to update opencode.json; wrapper and registry are still installed."
    return 0
  }

  if [[ "${removed_legacy:-0}" -gt 0 ]]; then
    log "Removed bare \"cursor-acp\" from plugin array (avoids broken cache package)."
  fi
  log "Updated opencode.json (provider cursor-acp, plugin ./plugin/cursor-acp.js)."
}

sync_models_if_requested() {
  [[ "$NO_PROVIDER" -eq 1 ]] && return 0
  [[ "$SKIP_MODELS" -eq 1 ]] && return 0
  [[ -f "$FORK_ROOT/dist/cli/opencode-cursor.js" ]] || return 0
  command -v bun >/dev/null 2>&1 || return 0

  log "Syncing models (cursor-agent)..."
  OPEN_CURSOR_DIR="$FORK_ROOT" bun run "$FORK_ROOT/dist/cli/opencode-cursor.js" \
    sync-models --variants --compact --config "$CONFIG_PATH" \
    || log "Warning: model sync failed; run sync-models manually later."
}

# --- main ---

log "OpenCode Cursor fork bootstrap"
log "=============================="
log "Fork root:     $FORK_ROOT"
log "Config:        $CONFIG_PATH"
log "Plugin:        $PLUGIN_PATH"
log ""

if [[ "$CHECK_ONLY" -eq 1 ]]; then
  [[ -f "$ENTRY" ]] || die "Build missing: $ENTRY (run without --check-only)"
  [[ -f "$REGISTRY_FILE" ]] || die "Registry missing: $REGISTRY_FILE"
  [[ -f "$PLUGIN_PATH" ]] || die "Plugin wrapper missing: $PLUGIN_PATH"
  registry_content="$(cat "$REGISTRY_FILE")"
  [[ "$registry_content" == "$FORK_ROOT" ]] || die "Registry points elsewhere: $registry_content"
  log "Check OK: build, registry, and plugin wrapper are present."
  exit 0
fi

require_cmd bun

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  log "Building fork..."
  (cd "$FORK_ROOT" && bun install && bun run build)
fi

[[ -f "$ENTRY" ]] || die "Build failed or dist missing: $ENTRY"

log "Registering fork path..."
write_marker_and_registry

log "Installing portable plugin wrapper..."
install_wrapper

log "Configuring OpenCode..."
ensure_opencode_json
sync_models_if_requested

log ""
log "Bootstrap complete."
log ""
log "Next steps:"
log "  1. cursor-agent login   (if not already)"
log "  2. opencode auth login  (provider: cursor-acp)"
log "  3. Restart OpenCode"
log ""
log "Verify:  ./scripts/bootstrap.sh --check-only"
log "Docs:    docs/PERSONAL_SETUP.md"
