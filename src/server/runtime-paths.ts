import { join, resolve } from 'node:path'

// Stable across npx cache updates and client/project working directories.
export const resolveRuntimePaths = (piAgentDir: string, env: NodeJS.ProcessEnv = process.env) => {
  const statusDir = resolve(env.PI_STATUS_DIR ?? join(piAgentDir, 'mcp', 'sub-pi-agent'))
  return { statusDir, agentsDir: resolve(env.PI_AGENTS_DIR ?? join(statusDir, 'agents')) }
}
