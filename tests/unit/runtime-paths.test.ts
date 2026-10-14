import { describe, it, expect } from 'vitest'
import { join, resolve } from 'node:path'
import { resolveRuntimePaths } from '../../src/server/runtime-paths.js'

describe('stable MCP state directories', () => {
  it('stores state beneath Pi configuration rather than the cwd or package cache', () => {
    const piDir = resolve('fixture-pi')
    const paths = resolveRuntimePaths(piDir, {})
    expect(paths.statusDir).toBe(join(piDir, 'mcp', 'sub-pi-agent'))
    expect(paths.agentsDir).toBe(join(paths.statusDir, 'agents'))
  })
  it('preserves explicit status and registry overrides', () => {
    const statusDir = resolve('fixture-status'), agentsDir = resolve('fixture-agents')
    expect(resolveRuntimePaths(resolve('pi'), { PI_STATUS_DIR: statusDir })).toEqual({ statusDir, agentsDir: join(statusDir, 'agents') })
    expect(resolveRuntimePaths(resolve('pi'), { PI_STATUS_DIR: statusDir, PI_AGENTS_DIR: agentsDir })).toEqual({ statusDir, agentsDir })
  })
})
