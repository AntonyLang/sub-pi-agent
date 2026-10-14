import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SettingsManager, getAgentDir } from '@earendil-works/pi-coding-agent'
import { readEffectivePiSettings } from '../../src/server/pi-client.js'

// readEffectivePiSettings is the production settings reader for resolving an omitted `model`.
// It delegates to Pi's own SettingsManager so global/project precedence is Pi's, not this plugin's.
// The tests build that layout in temp directories and point PI_CODING_AGENT_DIR at a throwaway
// agent dir — the user's real ~/.pi is never read or written.
//
// This is the only unit test file that exercises the real Pi SDK settings path; every other test
// injects a settings reader instead.
describe('readEffectivePiSettings (real Pi SettingsManager)', () => {
  const originalAgentDir = process.env.PI_CODING_AGENT_DIR
  let agentDir: string
  let projectDir: string

  const writeGlobalSettings = (settings: unknown) =>
    writeFile(join(agentDir, 'settings.json'), JSON.stringify(settings))

  const writeProjectSettings = async (settings: unknown) => {
    const dir = join(projectDir, '.pi')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'settings.json'), JSON.stringify(settings))
  }

  beforeEach(async () => {
    agentDir = await mkdtemp(join(tmpdir(), 'pi-agent-dir-'))
    projectDir = await mkdtemp(join(tmpdir(), 'pi-project-'))
    process.env.PI_CODING_AGENT_DIR = agentDir
  })

  afterEach(async () => {
    if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = originalAgentDir
    await rm(agentDir, { recursive: true, force: true })
    await rm(projectDir, { recursive: true, force: true })
  })

  it('reads the global default with the slash-containing model id intact', async () => {
    await writeGlobalSettings({ defaultProvider: 'cpa', defaultModel: 'deepseek/deepseek-v4.1-flash' })

    const settings = await readEffectivePiSettings({ cwd: projectDir })

    expect(settings.defaultProvider).toBe('cpa')
    expect(settings.defaultModel).toBe('deepseek/deepseek-v4.1-flash')
  })

  it('returns no default when settings carry none', async () => {
    await writeGlobalSettings({ theme: 'dark' })
    const settings = await readEffectivePiSettings({ cwd: projectDir })
    expect(settings.defaultProvider).toBeUndefined()
    expect(settings.defaultModel).toBeUndefined()
  })

  it('lets a project default override the global one (Pi-native precedence)', async () => {
    await writeGlobalSettings({ defaultProvider: 'cpa', defaultModel: 'deepseek/deepseek-v4.1-flash' })
    await writeProjectSettings({ defaultProvider: 'google', defaultModel: 'gemini-2.5-pro' })

    const settings = await readEffectivePiSettings({ cwd: projectDir })

    expect(settings.defaultProvider).toBe('google')
    expect(settings.defaultModel).toBe('gemini-2.5-pro')
  })

  it('still uses the global default when the project overrides only the provider', async () => {
    await writeGlobalSettings({ defaultProvider: 'cpa', defaultModel: 'deepseek/deepseek-v4.1-flash' })
    await writeProjectSettings({ defaultProvider: 'google' })

    const settings = await readEffectivePiSettings({ cwd: projectDir })

    expect(settings.defaultProvider).toBe('google')
    expect(settings.defaultModel).toBe('deepseek/deepseek-v4.1-flash')
  })

  it('matches what the SDK itself resolves for the same cwd (no extra trust policy layered on)', async () => {
    await writeGlobalSettings({ defaultProvider: 'cpa', defaultModel: 'deepseek/deepseek-v4.1-flash' })
    await writeProjectSettings({ defaultProvider: 'google', defaultModel: 'gemini-2.5-pro' })

    // Same construction the SDK's createAgentSession() performs for a session in this cwd.
    const expected = SettingsManager.create(projectDir, getAgentDir()).getSettings()
    const actual = await readEffectivePiSettings({ cwd: projectDir })

    expect(actual.defaultProvider).toBe(expected.defaultProvider)
    expect(actual.defaultModel).toBe(expected.defaultModel)
  })

  // The SDK silently degrades a malformed settings file to empty settings; drainErrors() is what
  // turns that into a hard failure so a task never launches on a half-read configuration.
  it('rejects instead of silently ignoring a malformed global settings file', async () => {
    await writeFile(join(agentDir, 'settings.json'), '{ "defaultProvider": "cpa", ')

    await expect(readEffectivePiSettings({ cwd: projectDir })).rejects.toThrow(/settings/i)
  })

  it('rejects instead of silently ignoring a malformed project settings file', async () => {
    await writeGlobalSettings({ defaultProvider: 'cpa', defaultModel: 'm' })
    const dir = join(projectDir, '.pi')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'settings.json'), 'not json')

    await expect(readEffectivePiSettings({ cwd: projectDir })).rejects.toThrow(/settings/i)
  })

  it('does not create or modify any settings file while reading', async () => {
    await writeGlobalSettings({ defaultProvider: 'cpa', defaultModel: 'm' })

    await readEffectivePiSettings({ cwd: projectDir })

    await expect(readFile(join(agentDir, 'settings.json'), 'utf-8')).resolves.toBe(
      JSON.stringify({ defaultProvider: 'cpa', defaultModel: 'm' })
    )
    await expect(readFile(join(projectDir, '.pi', 'settings.json'), 'utf-8')).rejects.toThrow()
  })
})