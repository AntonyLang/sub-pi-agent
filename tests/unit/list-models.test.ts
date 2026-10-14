import { describe, it, expect, vi } from 'vitest'
import { run } from '../../src/monitor/list-models.js'

const noSettings = async () => ({})
const noDetect = async (): Promise<boolean> => false

describe('list-models monitor', () => {
  it('happy path: formats available models and exits 0', async () => {
    const getAvailable = vi.fn(() => [
      { provider: 'google', id: 'gemini-2.5-pro' },
      { provider: 'google', id: 'gemini-2.0-flash' },
    ])
    const output = vi.fn()
    const exit = vi.fn()

    await run({ getAvailable, readSettings: noSettings, detectSuperpowers: noDetect, output, exit })

    expect(output).toHaveBeenCalledOnce()
    expect(output).toHaveBeenCalledWith(
      '[pi-models] Available: gemini-2.5-pro (frontier), gemini-2.0-flash (fast) — use pi_list_models to refresh'
    )
    expect(exit).toHaveBeenCalledWith(0)
  })

  it('empty models: outputs no-models message and exits 0', async () => {
    const getAvailable = vi.fn(() => [])
    const output = vi.fn()
    const exit = vi.fn()

    await run({ getAvailable, readSettings: noSettings, output, exit })

    expect(output).toHaveBeenCalledOnce()
    expect(output).toHaveBeenCalledWith(
      '[pi-models] No models available — configure Pi auth with `pi auth` or set provider env vars'
    )
    expect(exit).toHaveBeenCalledWith(0)
  })

  it('exception path (sync): output NOT called, exits 1', async () => {
    const getAvailable = vi.fn(() => { throw new Error('auth failed') })
    const output = vi.fn()
    const exit = vi.fn()

    await run({ getAvailable, readSettings: noSettings, output, exit })

    expect(output).not.toHaveBeenCalled()
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('exception path (async rejection): output NOT called, exits 1', async () => {
    const getAvailable = vi.fn(() => Promise.reject(new Error('network timeout')))
    const output = vi.fn()
    const exit = vi.fn()

    await run({ getAvailable, readSettings: noSettings, output, exit })

    expect(output).not.toHaveBeenCalled()
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('tier labels: frontier / fast / balanced', async () => {
    const output = vi.fn()
    const exit = vi.fn()

    await run({
      getAvailable: () => [
        { provider: 'google', id: 'gemini-2.5-pro' },
        { provider: 'google', id: 'gemini-2.0-flash' },
        { provider: 'acme', id: 'totally-unknown-model' },
      ],
      readSettings: noSettings,
      output,
      exit,
    })

    const line: string = output.mock.calls[0][0]
    expect(line).toContain('gemini-2.5-pro (frontier)')
    expect(line).toContain('gemini-2.0-flash (fast)')
    expect(line).toContain('totally-unknown-model (balanced)')
  })

  it('formatting: line starts with [pi-models] Available: and ends with — use pi_list_models to refresh', async () => {
    const output = vi.fn()
    const exit = vi.fn()

    await run({
      getAvailable: () => [{ provider: 'google', id: 'gemini-2.5-pro' }],
      readSettings: noSettings,
      output,
      exit,
    })

    const line: string = output.mock.calls[0][0]
    expect(line.startsWith('[pi-models] Available:')).toBe(true)
    expect(line.endsWith('— use pi_list_models to refresh')).toBe(true)
  })

  it('filters to enabledModels from Pi settings', async () => {
    const output = vi.fn()
    const exit = vi.fn()

    await run({
      getAvailable: () => [
        { provider: 'google', id: 'gemini-2.5-pro' },
        { provider: 'openai', id: 'gpt-4o' },
        { provider: 'acme', id: 'excluded-model' },
      ],
      readSettings: async () => ({
        enabledModels: ['google/gemini-2.5-pro', 'openai/gpt-4o'],
      }),
      output,
      exit,
    })

    const line: string = output.mock.calls[0][0]
    expect(line).toContain('gemini-2.5-pro')
    expect(line).toContain('gpt-4o')
    expect(line).not.toContain('excluded-model')
  })

  it('shows default model when Pi settings have defaultProvider + defaultModel', async () => {
    const output = vi.fn()
    const exit = vi.fn()

    await run({
      getAvailable: () => [
        { provider: 'opencode-go', id: 'glm-5.1' },
        { provider: 'google', id: 'gemini-2.5-pro' },
      ],
      readSettings: async () => ({
        defaultProvider: 'opencode-go',
        defaultModel: 'glm-5.1',
      }),
      output,
      exit,
    })

    const line: string = output.mock.calls[0][0]
    expect(line).toContain('default: opencode-go/glm-5.1')
  })

  it('omits default hint when no default is configured', async () => {
    const output = vi.fn()
    const exit = vi.fn()

    await run({
      getAvailable: () => [{ provider: 'google', id: 'gemini-2.5-pro' }],
      readSettings: noSettings,
      output,
      exit,
    })

    const line: string = output.mock.calls[0][0]
    expect(line).not.toContain('default:')
  })

  it('gracefully ignores a readSettings failure', async () => {
    const output = vi.fn()
    const exit = vi.fn()

    await run({
      getAvailable: () => [{ provider: 'google', id: 'gemini-2.5-pro' }],
      readSettings: async () => { throw new Error('disk error') },
      detectSuperpowers: noDetect,
      output,
      exit,
    })

    expect(exit).toHaveBeenCalledWith(0)
    expect(output).toHaveBeenCalledOnce()
  })

  describe('pi-subagents detection', () => {
    const withSubagents = async () => ({ packages: ['npm:pi-subagents'] })

    it('emits hint line when pi-subagents is an installed package', async () => {
      const output = vi.fn()
      const exit = vi.fn()

      await run({
        getAvailable: () => [{ provider: 'google', id: 'gemini-2.5-pro' }],
        readSettings: withSubagents,
        detectSuperpowers: noDetect,
        output,
        exit,
      })

      expect(output).toHaveBeenCalledTimes(2)
      expect(output.mock.calls[1][0]).toBe(
        '[pi-models] pi-subagents detected — delegated agents can fan out further via their own `subagent` tool'
      )
    })

    it('no hint when pi-subagents is not installed', async () => {
      const output = vi.fn()
      const exit = vi.fn()

      await run({
        getAvailable: () => [{ provider: 'google', id: 'gemini-2.5-pro' }],
        readSettings: async () => ({ packages: ['npm:pi-intercom'] }),
        detectSuperpowers: noDetect,
        output,
        exit,
      })

      expect(output).toHaveBeenCalledOnce()
    })

    // The hint follows the models line, so a fleet with no models must stay silent —
    // announcing nested delegation is misleading when nothing can be delegated at all.
    it('no hint when no models are available', async () => {
      const output = vi.fn()
      const exit = vi.fn()

      await run({
        getAvailable: () => [],
        readSettings: withSubagents,
        detectSuperpowers: noDetect,
        output,
        exit,
      })

      expect(output).toHaveBeenCalledOnce()
      expect(output.mock.calls[0][0]).toContain('No models available')
    })
  })

  describe('superpowers detection', () => {
    it('emits hint line when superpowers detected and models available', async () => {
      const output = vi.fn()
      const exit = vi.fn()

      await run({
        getAvailable: () => [{ provider: 'google', id: 'gemini-2.5-pro' }],
        readSettings: noSettings,
        detectSuperpowers: async () => true,
        output,
        exit,
      })

      expect(output).toHaveBeenCalledTimes(2)
      expect(output.mock.calls[1][0]).toBe(
        '[pi-models] superpowers detected — load claude-pi:superpowers skill for diverse agentic workflow integration'
      )
    })

    it('no hint when superpowers not detected', async () => {
      const output = vi.fn()
      const exit = vi.fn()

      await run({
        getAvailable: () => [{ provider: 'google', id: 'gemini-2.5-pro' }],
        readSettings: noSettings,
        detectSuperpowers: async () => false,
        output,
        exit,
      })

      expect(output).toHaveBeenCalledTimes(1)
    })

    it('no hint when no models available even if superpowers detected', async () => {
      const output = vi.fn()
      const exit = vi.fn()

      await run({
        getAvailable: () => [],
        readSettings: noSettings,
        detectSuperpowers: async () => true,
        output,
        exit,
      })

      expect(output).toHaveBeenCalledTimes(1)
      expect(output.mock.calls[0][0]).toContain('No models available')
    })

    it('gracefully ignores detection failure', async () => {
      const output = vi.fn()
      const exit = vi.fn()

      await run({
        getAvailable: () => [{ provider: 'google', id: 'gemini-2.5-pro' }],
        readSettings: noSettings,
        detectSuperpowers: async () => { throw new Error('fs error') },
        output,
        exit,
      })

      expect(exit).toHaveBeenCalledWith(0)
      expect(output).toHaveBeenCalledTimes(1)
    })
  })
})
