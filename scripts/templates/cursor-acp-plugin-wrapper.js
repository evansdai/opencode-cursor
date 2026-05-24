/**
 * Portable OpenCode plugin loader for a local opencode-cursor fork build.
 *
 * Resolution order (first match wins):
 *   1. OPEN_CURSOR_DIR environment variable
 *   2. ~/.config/opencode/.opencode-cursor-fork  (written by scripts/bootstrap.sh)
 *   3. Walk upward from this file for .opencode-cursor-fork marker (monorepo / dev)
 *
 * You do not need OPEN_CURSOR_DIR for day-to-day use after running bootstrap once.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MARKER_FILENAME = ".opencode-cursor-fork";
const REGISTRY_FILENAME = ".opencode-cursor-fork";

function getConfigHome() {
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  if (xdg) return resolve(xdg);
  return join(homedir(), ".config");
}

function readRegistryPath() {
  const registry = join(getConfigHome(), "opencode", REGISTRY_FILENAME);
  if (!existsSync(registry)) return null;
  const raw = readFileSync(registry, "utf8").trim();
  if (!raw) return null;
  return resolve(raw.split("\n")[0].trim());
}

function readMarkerNextToFile(startDir) {
  let dir = resolve(startDir);
  for (let i = 0; i < 12; i++) {
    const marker = join(dir, MARKER_FILENAME);
    if (existsSync(marker)) {
      const raw = readFileSync(marker, "utf8").trim();
      if (raw) return resolve(raw.split("\n")[0].trim());
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function resolveForkRoot() {
  const fromEnv = process.env.OPEN_CURSOR_DIR?.trim();
  if (fromEnv) return resolve(fromEnv);

  const fromRegistry = readRegistryPath();
  if (fromRegistry) return fromRegistry;

  const wrapperDir = dirname(fileURLToPath(import.meta.url));
  const fromMarker = readMarkerNextToFile(wrapperDir);
  if (fromMarker) return fromMarker;

  return null;
}

function resolveForkEntry() {
  const baseDir = resolveForkRoot();
  if (!baseDir) {
    throw new Error(
      "cursor-acp fork location unknown. Run bootstrap from your fork clone:\n"
      + "  ./scripts/bootstrap.sh\n"
      + "Or set OPEN_CURSOR_DIR to the fork checkout root.",
    );
  }
  const entry = join(baseDir, "dist", "plugin-entry.js");
  if (!existsSync(entry)) {
    throw new Error(
      `cursor-acp fork build not found at ${entry}.\n`
      + `  cd ${baseDir} && bun install && bun run build`,
    );
  }
  return entry;
}

export default async function CursorAcpForkPlugin(input) {
  const entry = resolveForkEntry();
  const mod = await import(pathToFileURL(entry).href);
  const plugin = mod.default ?? mod.CursorPlugin;
  if (typeof plugin !== "function") {
    throw new Error(`cursor-acp fork entry did not export a plugin function: ${entry}`);
  }
  return plugin(input);
}
