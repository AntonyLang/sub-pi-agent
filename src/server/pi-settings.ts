import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

export type PiSettings = {
  enabledModels?: string[]
  defaultModel?: string
  defaultProvider?: string
  // `pi install <source>` appends the source string here, e.g. "npm:pi-subagents".
  packages?: string[]
}

// pi-subagents registers a `subagent` tool that lets a delegated Pi agent spawn its own
// children. It is discovered through settings.packages (pi install writes the source
// string there), not through the extensions/ directory.
export const SUBAGENTS_PACKAGE = 'npm:pi-subagents'

export const hasSubagents = (settings: PiSettings): boolean =>
  (settings.packages ?? []).includes(SUBAGENTS_PACKAGE)

const DEFAULT_SETTINGS_PATH = join(homedir(), '.pi', 'agent', 'settings.json')

export const readPiSettings = async (path = DEFAULT_SETTINGS_PATH): Promise<PiSettings> => {
  try {
    const raw = await readFile(path, 'utf-8')
    return JSON.parse(raw) as PiSettings
  } catch {
    return {}
  }
}

// Only `*` is a glob token; every other regex metacharacter is escaped so it matches
// literally. `?` must be in that set — unescaped it is a quantifier, and a pattern that
// opens with one ("?foo") throws SyntaxError out of the session-start monitor.
const patternToRegex = (pattern: string): RegExp => {
  const escaped = pattern.replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`)
}

export const filterByEnabledModels = <T extends { provider: string; id: string }>(
  models: readonly T[],
  settings: PiSettings
): T[] => {
  const { enabledModels } = settings
  // ModelRuntime.getAvailable() hands back a readonly array; copy so the result is mutable.
  if (!enabledModels || enabledModels.length === 0) return [...models]
  const patterns = enabledModels.map(patternToRegex)
  return models.filter(m => {
    const key = `${m.provider}/${m.id}`
    return patterns.some(re => re.test(key))
  })
}
