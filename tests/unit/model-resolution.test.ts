import { describe, it, expect, vi } from 'vitest'
import { resolveModelKey } from '../../src/server/model-resolution.js'
import type { PiSettings } from '../../src/server/pi-settings.js'

// resolveModelKey is the "no explicit model" path: it re-reads Pi settings per call, checks the
// registry, and reports typed errors instead of guessing. Everything here is injected, so no test
// touches the real ~/.pi configuration.
const makeRuntime = (registered: string[] = []) => {
  const keys = new Set(registered)
  return {
    refresh: vi.fn(async () => {}),
    getModel: vi.fn((provider: string, id: string) => (keys.has(`${provider}/${id}`) ? { provider, id } : undefined)),
  }
}

describe('resolveModelKey', () => {
  it('combines provider and defaultModel, preserving slashes in the model id', async () => {
    const runtime = makeRuntime(['cpa/deepseek/deepseek-v4.1-flash'])
    const result = await resolveModelKey(runtime, {
      cwd: '/tmp',
      readSettings: async () => ({ defaultProvider: 'cpa', defaultModel: 'deepseek/deepseek-v4.1-flash' }),
    })

    expect(result).toEqual({ ok: true, modelKey: 'cpa/deepseek/deepseek-v4.1-flash' })
    expect(runtime.getModel).toHaveBeenCalledWith('cpa', 'deepseek/deepseek-v4.1-flash')
  })

  it('reads settings on every call so the next task follows a settings change', async () => {
    const runtime = makeRuntime(['cpa/deepseek/deepseek-v4.1-flash', 'google/gemini-2.5-pro'])
    const readSettings = vi
      .fn<[], Promise<PiSettings>>()
      .mockResolvedValueOnce({ defaultProvider: 'cpa', defaultModel: 'deepseek/deepseek-v4.1-flash' })
      .mockResolvedValueOnce({ defaultProvider: 'google', defaultModel: 'gemini-2.5-pro' })

    const first = await resolveModelKey(runtime, { cwd: '/tmp', readSettings })
    const second = await resolveModelKey(runtime, { cwd: '/a/different/project', readSettings })

    expect(first).toEqual({ ok: true, modelKey: 'cpa/deepseek/deepseek-v4.1-flash' })
    expect(second).toEqual({ ok: true, modelKey: 'google/gemini-2.5-pro' })
    expect(readSettings).toHaveBeenCalledTimes(2)
  })

  it('passes the task cwd to the settings reader', async () => {
    const readSettings = vi.fn(async () => ({ defaultProvider: 'cpa', defaultModel: 'm' }))
    await resolveModelKey(makeRuntime(['cpa/m']), { cwd: '/work/project', readSettings })
    expect(readSettings).toHaveBeenCalledWith({ cwd: '/work/project' })
  })

  it('refreshes the local registry (no network) before consulting it', async () => {
    const runtime = makeRuntime(['cpa/m'])
    await resolveModelKey(runtime, { cwd: '/tmp', readSettings: async () => ({ defaultProvider: 'cpa', defaultModel: 'm' }) })
    expect(runtime.refresh).toHaveBeenCalledWith({ allowNetwork: false })
  })

  it('reports default_model_missing when no default is configured', async () => {
    const result = await resolveModelKey(makeRuntime(), { cwd: '/tmp', readSettings: async () => ({}) })
    expect(result).toMatchObject({ ok: false, error: { kind: 'default_model_missing' } })
  })

  it.each([
    ['provider only', { defaultProvider: 'cpa' }],
    ['model only', { defaultModel: 'deepseek/deepseek-v4.1-flash' }],
    ['empty strings', { defaultProvider: '', defaultModel: '' }],
  ])('reports default_model_missing for an incomplete default (%s)', async (_label, settings) => {
    const result = await resolveModelKey(makeRuntime(), { cwd: '/tmp', readSettings: async () => settings })
    expect(result).toMatchObject({ ok: false, error: { kind: 'default_model_missing' } })
  })

  it('reports default_model_unavailable — never a fallback model — when the default is not registered', async () => {
    const runtime = makeRuntime([])   // registry knows about nothing
    const result = await resolveModelKey(runtime, {
      cwd: '/tmp',
      readSettings: async () => ({ defaultProvider: 'cpa', defaultModel: 'deepseek/deepseek-v4.1-flash' }),
    })

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'default_model_unavailable', provider: 'cpa', model: 'deepseek/deepseek-v4.1-flash' },
    })
  })

  it('reports settings_unreadable when the settings read throws', async () => {
    const result = await resolveModelKey(makeRuntime(), {
      cwd: '/tmp',
      readSettings: async () => { throw new Error('Unexpected token } in JSON') },
    })
    expect(result).toMatchObject({ ok: false, error: { kind: 'settings_unreadable' } })
    expect(result.ok === false && result.error.message).toContain('Unexpected token')
  })

  it('reports model_registry_unavailable when the registry reload fails', async () => {
    const runtime = makeRuntime(['cpa/m'])
    runtime.refresh.mockRejectedValueOnce(new Error('models.json is malformed'))

    // Continuing against a stale registry would ignore the user's current configuration.
    const result = await resolveModelKey(runtime, {
      cwd: '/tmp',
      readSettings: async () => ({ defaultProvider: 'cpa', defaultModel: 'm' }),
    })

    expect(result).toMatchObject({ ok: false, error: { kind: 'model_registry_unavailable' } })
    expect(runtime.getModel).not.toHaveBeenCalled()
  })
})