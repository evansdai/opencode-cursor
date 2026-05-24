# Personal fork setup (clone anywhere)

This guide is for using **your own `opencode-cursor` fork** with OpenCode—not the published npm package (`@rama_nigg/open-cursor`).

After one bootstrap run, you do **not** need `OPEN_CURSOR_DIR` unless you move the fork or run multiple forks.

## One-liner (new machine)

```bash
git clone <your-fork-url> opencode-cursor && cd opencode-cursor && ./scripts/bootstrap.sh
```

Requirements: **git**, **bun**, **cursor-agent** on `PATH`. On Windows use **Git Bash** or **WSL** for the bootstrap script.

## What bootstrap does

| Step | Result |
|------|--------|
| Build | `bun install && bun run build` → `dist/plugin-entry.js` |
| Registry | `~/.config/opencode/.opencode-cursor-fork` contains the **absolute** path to this clone |
| Marker | `.opencode-cursor-fork` in the repo root (same path, for dev/monorepo) |
| Plugin | Copies `scripts/templates/cursor-acp-plugin-wrapper.js` → `~/.config/opencode/plugin/cursor-acp.js` |
| Config | Adds `"./plugin/cursor-acp.js"` and `cursor-acp` provider to `opencode.json` (if missing) |
| Models | Optional: `sync-models --variants --compact` when `cursor-agent` is available |

## How the fork is found (no magic paths)

The plugin wrapper resolves the fork in this order:

1. **`OPEN_CURSOR_DIR`** — optional override (CI, multiple forks, temporary testing)
2. **`~/.config/opencode/.opencode-cursor-fork`** — written by bootstrap (normal daily use)
3. **Walk up from the wrapper** for `.opencode-cursor-fork` in a parent directory

There is **no** hardcoded `~/Documents/opencode-cursor`. Clone to `~/src/opencode-cursor`, `/opt/opencode-cursor`, etc.—bootstrap records the real path.

## Separate OpenCode config repo (optional)

If you keep `opencode.json`, agents, and tests in another git repo (for example `~/.config/opencode`):

1. Clone both repos.
2. Run bootstrap **from the fork** (this repo).
3. Ensure your config repo’s `opencode.json` includes:

   ```json
   "plugin": [
     "./plugin/cursor-acp.js"
   ]
   ```

4. Either let bootstrap update `~/.config/opencode/opencode.json`, or copy the wrapper template into your config repo’s `plugin/cursor-acp.js` and run bootstrap once so the registry file points at your fork.

The registry file always lives under **`$XDG_CONFIG_HOME/opencode`** (default `~/.config/opencode`), even when `OPENCODE_CONFIG` points at another `opencode.json`.

## Environment variables (reference)

| Variable | When you need it |
|----------|------------------|
| `OPEN_CURSOR_DIR` | Override fork root; **not** required after bootstrap |
| `XDG_CONFIG_HOME` | Non-default config directory (Linux/macOS) |
| `OPENCODE_CONFIG` | Path to `opencode.json` if not `~/.config/opencode/opencode.json` |
| `CURSOR_ACP_BENCHMARK_FAST_PATH=1` | Harness/benchmark only; synthetic tool calls |
| `CURSOR_ACP_PORT` | Proxy port (default `32124`) |

## After bootstrap

```bash
cursor-agent login
opencode auth login   # provider: cursor-acp
# Restart OpenCode
./scripts/bootstrap.sh --check-only
```

## Options

```bash
./scripts/bootstrap.sh --help
./scripts/bootstrap.sh --check-only      # verify build + registry + wrapper
./scripts/bootstrap.sh --skip-build      # dist already built
./scripts/bootstrap.sh --skip-models     # skip cursor-agent model sync
./scripts/bootstrap.sh --no-provider   # only build + registry + wrapper
./scripts/bootstrap.sh --config /path/to/opencode.json
```

## Windows notes

- Run `./scripts/bootstrap.sh` in **Git Bash** or **WSL**.
- Config path is still `%USERPROFILE%\.config\opencode` unless you set `XDG_CONFIG_HOME` or `OPENCODE_CONFIG`.
- Native PowerShell bootstrap is not provided yet; the wrapper and plugin work on Node once bootstrap has run under Bash.

## Moving or renaming the fork

```bash
cd /new/path/opencode-cursor
./scripts/bootstrap.sh
```

This rewrites the registry and marker. You only need `OPEN_CURSOR_DIR` if you want to point at a fork **without** re-running bootstrap.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `fork location unknown` | Run `./scripts/bootstrap.sh` from the fork root |
| `build not found at .../dist/plugin-entry.js` | `bun install && bun run build` in the fork |
| OpenCode still uses old npm plugin | Remove `@rama_nigg/open-cursor@...` from `plugin` array; keep `./plugin/cursor-acp.js` |
| Wrong fork loaded | Check `cat ~/.config/opencode/.opencode-cursor-fork` |
| Models empty | `bun run dist/cli/opencode-cursor.js sync-models --variants --compact` after `cursor-agent login` |

## Published package vs this fork

| | npm `@rama_nigg/open-cursor` | This fork + bootstrap |
|--|------------------------------|------------------------|
| Install | `install.sh` / `open-cursor install` | `./scripts/bootstrap.sh` |
| Updates | `npm update -g` | `git pull` + re-run bootstrap |
| Custom tool-contract fixes | Upstream only | Your branch |
| Path | Global npm path | Registry file (any clone location) |
