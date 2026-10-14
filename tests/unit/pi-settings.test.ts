import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readPiSettings, filterByEnabledModels } from '../../src/server/pi-settings.js'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('readPiSettings', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pi-settings-test-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('returns enabledModels and default from a valid settings file', async () => {
    const settings = {
      defaultProvider: 'opencode-go',
      defaultModel: 'glm-5.1',
      enabledModels: ['opencode-go/glm-5.1', 'github-copilot/gpt-4o'],
    }
    await writeFile(join(dir, 'settings.json'), JSON.stringify(settings))

    const result = await readPiSettings(join(dir, 'settings.json'))

    expect(result.enabledModels).toEqual(['opencode-go/glm-5.1', 'github-copilot/gpt-4o'])
    expect(result.defaultModel).toBe('glm-5.1')
    expect(result.defaultProvider).toBe('opencode-go')
  })

  it('returns empty object when file does not exist', async () => {
    const result = await readPiSettings(join(dir, 'no-such-file.json'))
    expect(result).toEqual({})
  })

  it('returns empty object when file contains invalid JSON', async () => {
    await writeFile(join(dir, 'settings.json'), 'not json {{{')
    const result = await readPiSettings(join(dir, 'settings.json'))
    expect(result).toEqual({})
  })

  it('returns partial shape when some fields are absent', async () => {
    await writeFile(join(dir, 'settings.json'), JSON.stringify({ theme: 'dark' }))
    const result = await readPiSettings(join(dir, 'settings.json'))
    expect(result.enabledModels).toBeUndefined()
    expect(result.defaultModel).toBeUndefined()
  })
})

describe('filterByEnabledModels', () => {
  const models = [
    { provider: 'opencode-go', id: 'glm-5.1' },
    { provider: 'github-copilot', id: 'gpt-4o' },
    { provider: 'google-gemini-cli', id: 'gemini-2.5-flash' },
  ]

  it('filters to only enabled models when enabledModels is set', () => {
    const result = filterByEnabledModels(models, {
      enabledModels: ['opencode-go/glm-5.1', 'github-copilot/gpt-4o'],
    })
    expect(result).toHaveLength(2)
    expect(result[0].id).toBe('glm-5.1')
    expect(result[1].id).toBe('gpt-4o')
  })

  it('returns all models when enabledModels is absent', () => {
    const result = filterByEnabledModels(models, {})
    expect(result).toHaveLength(3)
  })

  it('returns all models when enabledModels is empty', () => {
    const result = filterByEnabledModels(models, { enabledModels: [] })
    expect(result).toHaveLength(3)
  })

  it('returns empty array when no models match the enabled list', () => {
    const result = filterByEnabledModels(models, {
      enabledModels: ['opencode/nonexistent'],
    })
    expect(result).toHaveLength(0)
  })

  it('preserves original model objects (no mutation)', () => {
    const original = [...models]
    filterByEnabledModels(models, { enabledModels: ['opencode-go/glm-5.1'] })
    expect(models).toEqual(original)
  })

  it('matches provider-wide wildcard patterns (e.g. "provider/*")', () => {
    const result = filterByEnabledModels(models, {
      enabledModels: ['github-copilot/*'],
    })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('gpt-4o')
  })

  it('matches partial-id wildcard patterns (e.g. "provider/prefix-*")', () => {
    const result = filterByEnabledModels(
      [...models, { provider: 'opencode-go', id: 'glm-5.2' }],
      { enabledModels: ['opencode-go/glm-5.*'] }
    )
    expect(result).toHaveLength(2)
    expect(result.map(m => m.id)).toEqual(['glm-5.1', 'glm-5.2'])
  })

  it('treats regex metacharacters as literals rather than throwing', () => {
    // Only `*` is a glob token. An unescaped `?` is a quantifier, and a pattern
    // opening with one used to throw SyntaxError out of the session-start monitor,
    // taking down model listing entirely instead of simply matching nothing.
    expect(() => filterByEnabledModels(models, { enabledModels: ['?'] })).not.toThrow()
    expect(filterByEnabledModels(models, { enabledModels: ['?'] })).toEqual([])
    expect(filterByEnabledModels(models, { enabledModels: ['github-copilot/gpt-4o?'] })).toEqual([])
  })
})
