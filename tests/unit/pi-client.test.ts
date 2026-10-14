import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makePiClient, makePiSessionAdapter, makePiSessionFactory } from '../../src/server/pi-client.js'
import { createAgentSession, SessionManager } from '@earendil-works/pi-coding-agent'
import type { ActiveSession, ModelInfo, SessionFactory } from '../../src/server/types.js'

vi.mock('@earendil-works/pi-coding-agent', () => ({
  createAgentSession: vi.fn(),
  ModelRuntime: class {},
  SessionManager: { inMemory: vi.fn((cwd: string) => ({ cwd })) },
  // Only used by readEffectivePiSettings; every test below injects its own settings reader.
  SettingsManager: { create: vi.fn() },
  getAgentDir: vi.fn(() => '/agent-dir'),
}))

// Minimal mock of a Pi AgentSession
const makeMockPiSession = () => {
  let listener: ((e: unknown) => void) | null = null
  return {
    steer:     vi.fn(async () => {}),
    abort:     vi.fn(async () => {}),
    subscribe: vi.fn((cb: (e: unknown) => void) => { listener = cb; return () => {} }),
    emit:      (event: unknown) => { listener?.(event) },
  }
}

// Pi SDK's normalized AssistantMessageEvent format (same across all providers)
const textDeltaEvent = (text: string) => ({
  type: 'message_update',
  assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: text },
})
const agentEndEvent = () => ({ type: 'agent_end', messages: [] })
// Pi SDK nests stopReason/errorMessage inside message, not at event top level
const messageEndErrorEvent = (msg: string) => ({ type: 'message_end', message: { stopReason: 'error', errorMessage: msg } })

// Real Pi SDK message boundaries: agent-loop.ts emits message_start/message_end around every
// message (assistant, user, toolResult), and message_update only while an assistant message streams.
const assistantStartEvent = () => ({ type: 'message_start', message: { role: 'assistant', content: [] } })
const assistantEndEvent   = () => ({ type: 'message_end',   message: { role: 'assistant', stopReason: 'end_turn', content: [] } })
const userStartEvent      = () => ({ type: 'message_start', message: { role: 'user', content: 'steer' } })
const userEndEvent        = () => ({ type: 'message_end',   message: { role: 'user', content: 'steer' } })
const toolResultStartEvent = () => ({ type: 'message_start', message: { role: 'toolResult', content: [] } })
const toolResultEndEvent   = () => ({ type: 'message_end',   message: { role: 'toolResult', content: [] } })
const thinkingDeltaEvent  = (text: string) => ({
  type: 'message_update',
  assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: text },
})
const toolCallDeltaEvent  = () => ({
  type: 'message_update',
  assistantMessageEvent: { type: 'toolcall_delta', contentIndex: 1, delta: '{}' },
})
const toolExecutionEvent  = () => ({ type: 'tool_execution_start', toolCallId: 'call-1', toolName: 'bash', args: {} })

// Minimal mock that satisfies ActiveSession
const makeActiveSession = (): ActiveSession => ({
  steer: vi.fn(),
  abort: vi.fn(),
  subscribe: vi.fn(() => () => {}),
})

// Mock modelRuntime — no Pi SDK import needed in tests
const mockModelRuntime = {
  refresh: vi.fn(async () => {}),
  getModel: vi.fn(() => undefined),
  getAvailable: vi.fn(async () => [
    { provider: 'google', id: 'gemini-2.5-pro' },
    { provider: 'google', id: 'gemini-2.0-flash' },
    { provider: 'openai', id: 'gpt-4o' },
  ]),
}

describe('makePiClient', () => {
  it('startSession calls factory with task, modelKey, and cwd', async () => {
    const factory: SessionFactory = vi.fn(async () => makeActiveSession())
    const client = makePiClient(factory, mockModelRuntime)

    await client.startSession('do the thing', 'google/gemini-2.0-flash', '/tmp')

    expect(factory).toHaveBeenCalledWith('do the thing', 'google/gemini-2.0-flash', '/tmp', undefined)
  })

  it('startSession returns the factory\'s session object unchanged, plus the resolved model key', async () => {
    const session = makeActiveSession()
    const factory: SessionFactory = async () => session
    const client = makePiClient(factory, mockModelRuntime)

    const result = await client.startSession('task', 'google/gpt-4o', '/tmp')
    // Same object — the client wraps it rather than decorating the session, so the tools keep
    // getting the exact ActiveSession the factory produced.
    expect(result.session).toBe(session)
    expect(result.modelKey).toBe('google/gpt-4o')
  })

  it('listModels returns ModelInfo with key, provider, id, tier', async () => {
    const client = makePiClient(vi.fn(), mockModelRuntime, { readSettings: async () => ({}) })
    const models = await client.listModels()

    expect(models).toEqual([
      { key: 'google/gemini-2.5-pro',   provider: 'google', id: 'gemini-2.5-pro',   tier: 'frontier' },
      { key: 'google/gemini-2.0-flash', provider: 'google', id: 'gemini-2.0-flash', tier: 'fast'     },
      { key: 'openai/gpt-4o',           provider: 'openai', id: 'gpt-4o',           tier: 'balanced' },
    ])
  })

  it('listModels falls back to "balanced" tier for unknown model ids', async () => {
    const registry = {
      getAvailable: vi.fn(async () => [{ provider: 'acme', id: 'unknown-model-x' }]),
    }
    const client = makePiClient(vi.fn(), registry, { readSettings: async () => ({}) })
    const models = await client.listModels()
    expect(models[0].tier).toBe('balanced')
  })

  it('listModels filters to enabledModels when Pi settings are present', async () => {
    const readSettings = vi.fn(async () => ({
      enabledModels: ['google/gemini-2.5-pro', 'openai/gpt-4o'],
    }))
    const client = makePiClient(vi.fn(), mockModelRuntime, { readSettings })
    const models = await client.listModels()

    expect(models).toHaveLength(2)
    expect(models.map(m => m.key)).toEqual(['google/gemini-2.5-pro', 'openai/gpt-4o'])
  })

  it('listModels returns all models when enabledModels is absent in settings', async () => {
    const readSettings = vi.fn(async () => ({}))
    const client = makePiClient(vi.fn(), mockModelRuntime, { readSettings })
    const models = await client.listModels()
    expect(models).toHaveLength(3)
  })

  it('listModels returns all models when readSettings throws', async () => {
    // listModels has no task to protect, so a settings failure degrades to "no filter" here.
    // Model resolution for an omitted `model` does NOT degrade — see the suite below.
    const readSettings = vi.fn(async () => { throw new Error('read failed') })
    const client = makePiClient(vi.fn(), mockModelRuntime, { readSettings })
    const models = await client.listModels()
    expect(models).toHaveLength(3)
  })
})

// The pi_run_task / pi_spawn_agent contract when `model` is omitted: resolve from Pi settings at
// task start, hand the resolved key to the factory, and never substitute a different model.
describe('makePiClient.startSession model resolution', () => {
  // The user's current default: provider + a model id that itself contains a slash.
  const DEFAULT_KEY = 'cpa/deepseek/deepseek-v4.1-flash'

  const makeRuntime = (registered: string[]) => {
    const keys = new Set(registered)
    return {
      refresh: vi.fn(async () => {}),
      getModel: vi.fn((provider: string, id: string) =>
        keys.has(`${provider}/${id}`) ? { provider, id } : undefined),
    }
  }

  const makeClientFor = (runtime: unknown, readSettings: () => Promise<Record<string, unknown>>) => {
    const factory: SessionFactory = vi.fn(async () => makeActiveSession())
    const client = makePiClient(factory, runtime as never, { readSettings: readSettings as never })
    return { client, factory }
  }

  it('returns { session, modelKey } so callers can log the model that actually ran', async () => {
    const { client } = makeClientFor(makeRuntime([DEFAULT_KEY]), async () => ({}))

    const started = await client.startSession('task', 'google/gemini-2.0-flash', '/tmp')
    expect(started.session).toBeDefined()
    expect(started.modelKey).toBe('google/gemini-2.0-flash')
  })

  it('does not read settings at all when an explicit model is given', async () => {
    const readSettings = vi.fn(async () => ({}))
    const { client, factory } = makeClientFor(makeRuntime([]), readSettings)

    await client.startSession('task', 'google/gemini-2.0-flash', '/tmp')

    expect(readSettings).not.toHaveBeenCalled()
    expect(factory).toHaveBeenCalledWith('task', 'google/gemini-2.0-flash', '/tmp', undefined)
  })

  it('resolves the Pi default (slash-containing id intact) when the model is omitted', async () => {
    const { client, factory } = makeClientFor(makeRuntime([DEFAULT_KEY]), async () => ({
      defaultProvider: 'cpa',
      defaultModel: 'deepseek/deepseek-v4.1-flash',
    }))

    const started = await client.startSession('task', undefined, '/tmp')

    expect(factory).toHaveBeenCalledWith('task', DEFAULT_KEY, '/tmp', undefined)
    expect(started.modelKey).toBe(DEFAULT_KEY)
  })

  it('rejects with default_model_missing when no default is configured', async () => {
    const { client, factory } = makeClientFor(makeRuntime([DEFAULT_KEY]), async () => ({}))

    await expect(client.startSession('task', undefined, '/tmp'))
      .rejects.toMatchObject({ kind: 'default_model_missing' })
    expect(factory).not.toHaveBeenCalled()
  })

  it('rejects with default_model_unavailable when the default is not in the registry', async () => {
    const { client, factory } = makeClientFor(makeRuntime([]), async () => ({
      defaultProvider: 'cpa',
      defaultModel: 'deepseek/deepseek-v4.1-flash',
    }))

    await expect(client.startSession('task', undefined, '/tmp')).rejects.toMatchObject({
      kind: 'default_model_unavailable',
      provider: 'cpa',
      model: 'deepseek/deepseek-v4.1-flash',
    })
    expect(factory).not.toHaveBeenCalled()
  })

  it('rejects with settings_unreadable rather than falling back to another model', async () => {
    const { client, factory } = makeClientFor(makeRuntime([DEFAULT_KEY]), async () => {
      throw new Error('settings.json is malformed')
    })

    await expect(client.startSession('task', undefined, '/tmp'))
      .rejects.toMatchObject({ kind: 'settings_unreadable' })
    expect(factory).not.toHaveBeenCalled()
  })

  it('picks up a settings change for the next session, leaving the earlier one untouched', async () => {
    let settings = { defaultProvider: 'cpa', defaultModel: 'deepseek/deepseek-v4.1-flash' }
    const { client, factory } = makeClientFor(
      makeRuntime([DEFAULT_KEY, 'google/gemini-2.5-pro']),
      async () => settings
    )

    const first = await client.startSession('first', undefined, '/tmp')
    settings = { defaultProvider: 'google', defaultModel: 'gemini-2.5-pro' }
    const second = await client.startSession('second', undefined, '/tmp')

    expect(first.modelKey).toBe(DEFAULT_KEY)
    expect(second.modelKey).toBe('google/gemini-2.5-pro')
    expect(factory).toHaveBeenNthCalledWith(1, 'first', DEFAULT_KEY, '/tmp', undefined)
    expect(factory).toHaveBeenNthCalledWith(2, 'second', 'google/gemini-2.5-pro', '/tmp', undefined)
  })
})

describe('makePiSessionAdapter event buffering', () => {
  it('preserves the Pi session receiver when queueing follow-up input', async () => {
    const pi = {
      ...makeMockPiSession(),
      queued: [] as string[],
      async followUp(text: string) { this.queued.push(text); return 'queued' },
    }
    await makePiSessionAdapter(pi).followUp('continue')
    expect(pi.queued).toEqual(['continue'])
  })

  it('replays text deltas that fired before subscribe was called', () => {
    const pi = makeMockPiSession()
    const adapted = makePiSessionAdapter(pi)

    // Events fire before caller subscribes (the race condition scenario)
    pi.emit(textDeltaEvent('hello '))
    pi.emit(textDeltaEvent('world'))
    pi.emit(agentEndEvent())

    const onDelta = vi.fn()
    const onEnd   = vi.fn()
    adapted.subscribe(onDelta, onEnd, vi.fn())

    expect(onDelta).toHaveBeenCalledWith('hello ')
    expect(onDelta).toHaveBeenCalledWith('world')
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('forwards events immediately when subscribe is already set up', () => {
    const pi = makeMockPiSession()
    const adapted = makePiSessionAdapter(pi)

    const onDelta = vi.fn()
    const onEnd   = vi.fn()
    adapted.subscribe(onDelta, onEnd, vi.fn())

    // Events fire after caller subscribes (normal scenario)
    pi.emit(textDeltaEvent('async output'))
    pi.emit(agentEndEvent())

    expect(onDelta).toHaveBeenCalledWith('async output')
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('drains buffer exactly once — replayed events not fired again', () => {
    const pi = makeMockPiSession()
    const adapted = makePiSessionAdapter(pi)

    pi.emit(textDeltaEvent('buffered'))
    pi.emit(agentEndEvent())

    const onDelta = vi.fn()
    const onEnd   = vi.fn()
    adapted.subscribe(onDelta, onEnd, vi.fn())

    // Re-subscribing after unsubscribe should NOT replay old events
    const unsub = adapted.subscribe(vi.fn(), vi.fn(), vi.fn())
    expect(onDelta).toHaveBeenCalledTimes(1)  // only from first subscribe
  })

  it('calls onError (not onEnd) when agent_end follows message_end with stopReason error', () => {
    const pi = makeMockPiSession()
    const adapted = makePiSessionAdapter(pi)

    const onEnd   = vi.fn()
    const onError = vi.fn()
    adapted.subscribe(vi.fn(), onEnd, onError)

    pi.emit(messageEndErrorEvent('400 provider rejected request'))
    pi.emit(agentEndEvent())

    expect(onError).toHaveBeenCalledWith('400 provider rejected request')
    expect(onEnd).not.toHaveBeenCalled()
  })

  it('calls onEnd (not onError) when agent_end follows a non-error message_end', () => {
    const pi = makeMockPiSession()
    const adapted = makePiSessionAdapter(pi)

    const onEnd   = vi.fn()
    const onError = vi.fn()
    adapted.subscribe(vi.fn(), onEnd, onError)

    pi.emit({ type: 'message_end', message: { stopReason: 'end_turn' } })
    pi.emit(agentEndEvent())

    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
  })

  it('ignores non-text-delta message_update events (thinking, toolcall, etc.)', () => {
    const pi = makeMockPiSession()
    const adapted = makePiSessionAdapter(pi)

    pi.emit({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: 'hmm' } })
    pi.emit({ type: 'message_update', assistantMessageEvent: { type: 'toolcall_delta', contentIndex: 1, delta: '{}' } })
    pi.emit({ type: 'tool_execution_start', toolCallId: 'x', toolName: 'bash', args: {} })

    const onDelta = vi.fn()
    const onEnd   = vi.fn()
    adapted.subscribe(onDelta, onEnd, vi.fn())

    expect(onDelta).not.toHaveBeenCalled()
    expect(onEnd).not.toHaveBeenCalled()
  })
})

// The optional 4th subscribe callback reports the newest assistant reply only. Boundaries come from
// the real SDK message_start/message_end pair — never from text_delta/newline/paragraph heuristics.
describe('makePiSessionAdapter latest assistant reply', () => {
  it('reports compact activity for silent thinking/tool turns without leaking their contents', () => {
    const pi = makeMockPiSession()
    const adapted = makePiSessionAdapter(pi)
    const replies = vi.fn(), activities = vi.fn()
    adapted.subscribe(vi.fn(), vi.fn(), vi.fn(), replies, activities)
    pi.emit(assistantStartEvent()); pi.emit(textDeltaEvent('Working.')); pi.emit(assistantEndEvent())
    pi.emit(assistantStartEvent()); pi.emit(thinkingDeltaEvent('private reasoning'))
    pi.emit(thinkingDeltaEvent('more private reasoning'))
    pi.emit(toolCallDeltaEvent()); pi.emit(assistantEndEvent())
    pi.emit({ type: 'tool_execution_start', toolName: 'bash', args: { command: 'private command' } })
    pi.emit({ type: 'tool_execution_end', toolName: 'bash', isError: true, result: 'private output' })
    expect(replies.mock.calls).toEqual([['Working.']])
    expect(activities.mock.calls.map(([a]) => a.phase)).toEqual(['replying', 'thinking', 'calling_tool', 'tool_running', 'tool_finished'])
    expect(activities.mock.calls.at(-1)?.[0]).toEqual({ phase: 'tool_finished', tool_name: 'bash', is_error: true, updated_at: expect.any(Number) })
    expect(JSON.stringify(activities.mock.calls)).not.toContain('private')
  })

  const subscribeWithReply = (adapted: ActiveSession) => {
    const deltas: string[] = []
    const replies: string[] = []
    const onEnd = vi.fn()
    const onError = vi.fn()
    adapted.subscribe(
      (d) => deltas.push(d),
      onEnd,
      onError,
      (r) => replies.push(r),
    )
    return { deltas, replies, onEnd, onError }
  }

  it('reports the newest assistant reply only, across user and toolResult turns', () => {
    const pi = makeMockPiSession()
    const adapted = makePiSessionAdapter(pi)
    const { deltas, replies } = subscribeWithReply(adapted)

    pi.emit(assistantStartEvent())
    pi.emit(textDeltaEvent('first '))
    pi.emit(textDeltaEvent('reply'))
    pi.emit(assistantEndEvent())
    // A steer the user sent, and a tool result — neither is assistant text.
    pi.emit(userStartEvent())
    pi.emit(userEndEvent())
    pi.emit(toolResultStartEvent())
    pi.emit(toolResultEndEvent())
    pi.emit(assistantStartEvent())
    pi.emit(textDeltaEvent('second '))
    pi.emit(textDeltaEvent('reply'))
    pi.emit(assistantEndEvent())

    expect(deltas).toEqual(['first ', 'reply', 'second ', 'reply'])
    expect(replies).toEqual(['first ', 'first reply', 'second ', 'second reply'])
  })

  it('keeps the previous reply when a turn only thinks or calls tools', () => {
    const pi = makeMockPiSession()
    const adapted = makePiSessionAdapter(pi)
    const { replies } = subscribeWithReply(adapted)

    pi.emit(assistantStartEvent())
    pi.emit(textDeltaEvent('progress so far'))
    pi.emit(assistantEndEvent())

    const afterFirstReply = replies.length
    pi.emit(assistantStartEvent())
    pi.emit(thinkingDeltaEvent('hmm'))
    pi.emit(toolCallDeltaEvent())
    pi.emit(assistantEndEvent())
    pi.emit(toolExecutionEvent())
    pi.emit(assistantStartEvent())
    pi.emit(thinkingDeltaEvent('more thinking'))
    pi.emit(assistantEndEvent())

    // No new snapshot was pushed, so a poll would still report the previous reply.
    expect(replies.length).toBe(afterFirstReply)
    expect(replies[afterFirstReply - 1]).toBe('progress so far')
  })

  it('treats multiple text blocks in one assistant message as a single reply', () => {
    const pi = makeMockPiSession()
    const adapted = makePiSessionAdapter(pi)
    const { replies } = subscribeWithReply(adapted)

    pi.emit(assistantStartEvent())
    pi.emit(textDeltaEvent('part one '))
    pi.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_end', contentIndex: 0, content: 'part one ' } })
    pi.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_start', contentIndex: 1 } })
    pi.emit(textDeltaEvent('part two'))
    pi.emit(assistantEndEvent())

    expect(replies[replies.length - 1]).toBe('part one part two')
  })

  it('replays buffered events in order and honours the new-reply boundary', () => {
    const pi = makeMockPiSession()
    const adapted = makePiSessionAdapter(pi)

    // Everything below fires before the caller subscribes (the real race condition).
    pi.emit(assistantStartEvent())
    pi.emit(textDeltaEvent('a'))
    pi.emit(textDeltaEvent('b'))
    pi.emit(assistantEndEvent())
    pi.emit(userStartEvent())
    pi.emit(userEndEvent())
    pi.emit(assistantStartEvent())
    pi.emit(textDeltaEvent('c'))
    pi.emit(assistantEndEvent())
    pi.emit(agentEndEvent())

    const { deltas, replies, onEnd } = subscribeWithReply(adapted)

    expect(deltas).toEqual(['a', 'b', 'c'])
    expect(replies).toEqual(['a', 'ab', 'c'])
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('reports no reply until an assistant text delta arrives', () => {
    const pi = makeMockPiSession()
    const adapted = makePiSessionAdapter(pi)
    const { replies } = subscribeWithReply(adapted)

    pi.emit(assistantStartEvent())
    pi.emit(thinkingDeltaEvent('only thinking'))
    pi.emit(toolCallDeltaEvent())
    pi.emit(assistantEndEvent())
    pi.emit(toolExecutionEvent())
    pi.emit(agentEndEvent())

    expect(replies).toEqual([])
  })

  it('keeps the reply across an aborted/errored assistant message and still reports the error', () => {
    const pi = makeMockPiSession()
    const adapted = makePiSessionAdapter(pi)
    const { replies, onEnd, onError } = subscribeWithReply(adapted)

    pi.emit(assistantStartEvent())
    pi.emit(textDeltaEvent('partial answer'))
    pi.emit({ type: 'message_end', message: { role: 'assistant', stopReason: 'error', errorMessage: '400 provider rejected request' } })
    pi.emit(agentEndEvent())

    expect(replies[replies.length - 1]).toBe('partial answer')
    expect(onError).toHaveBeenCalledWith('400 provider rejected request')
    expect(onEnd).not.toHaveBeenCalled()
  })

  it('does not end an in-flight assistant reply on user/toolResult message events', () => {
    const pi = makeMockPiSession()
    const adapted = makePiSessionAdapter(pi)
    const { replies } = subscribeWithReply(adapted)

    pi.emit(assistantStartEvent())
    pi.emit(textDeltaEvent('A'))
    // The SDK emits message_start/message_end for the user steer and the tool result too; those
    // carry an explicit role and must not close the assistant message still streaming.
    pi.emit(userStartEvent())
    pi.emit(userEndEvent())
    pi.emit(toolResultStartEvent())
    pi.emit(toolResultEndEvent())
    pi.emit(textDeltaEvent('B'))

    expect(replies[replies.length - 1]).toBe('AB')

    // The assistant's own end closes it; the next assistant message replaces the reply.
    pi.emit(assistantEndEvent())
    pi.emit(assistantStartEvent())
    pi.emit(textDeltaEvent('C'))
    pi.emit(assistantEndEvent())
    expect(replies[replies.length - 1]).toBe('C')
  })

  it('closes the reply on the assistant message_end in the normal SDK order', () => {
    const pi = makeMockPiSession()
    const adapted = makePiSessionAdapter(pi)
    const { replies } = subscribeWithReply(adapted)

    pi.emit(assistantStartEvent())
    pi.emit(textDeltaEvent('one'))
    pi.emit(assistantEndEvent())
    // No open message: this delta must start a fresh reply, not append to 'one'.
    pi.emit(textDeltaEvent('two'))

    expect(replies).toEqual(['one', 'two'])
  })

  it('treats a role-less legacy message_end as the assistant end while a reply is open', () => {
    const pi = makeMockPiSession()
    const adapted = makePiSessionAdapter(pi)
    const { replies } = subscribeWithReply(adapted)

    pi.emit(assistantStartEvent())
    pi.emit(textDeltaEvent('first'))
    pi.emit({ type: 'message_end', message: {} })
    pi.emit(textDeltaEvent('second'))

    expect(replies).toEqual(['first', 'second'])
  })

  it('starts an implicit reply if a text delta arrives without a message_start', () => {
    const pi = makeMockPiSession()
    const adapted = makePiSessionAdapter(pi)
    const { replies } = subscribeWithReply(adapted)

    pi.emit(textDeltaEvent('orphan text'))

    expect(replies).toEqual(['orphan text'])
  })

  it('does not change the three-argument subscriber contract', () => {
    const pi = makeMockPiSession()
    const adapted = makePiSessionAdapter(pi)

    pi.emit(assistantStartEvent())
    pi.emit(textDeltaEvent('three args'))
    pi.emit(assistantEndEvent())
    pi.emit(agentEndEvent())

    const onDelta = vi.fn()
    const onEnd = vi.fn()
    const onError = vi.fn()
    adapted.subscribe(onDelta, onEnd, onError)

    expect(onDelta).toHaveBeenCalledWith('three args')
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
  })
})

describe('makePiSessionFactory', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('isolates the transcript and cwd of separately spawned workers', async () => {
    vi.mocked(createAgentSession).mockImplementation(async () => ({
      session: {
        ...makeMockPiSession(),
        prompt: vi.fn(async () => {}),
      },
    }) as any)
    const factory = makePiSessionFactory({
      modelRuntime: { getModel: vi.fn().mockReturnValue({ provider: 'cpa', id: 'deepseek/flash' }) } as any,
    })
    await factory('task A', 'cpa/deepseek/flash', '/project-a')
    await factory('task B', 'cpa/deepseek/flash', '/project-b')
    const [first, second] = vi.mocked(createAgentSession).mock.calls.map(([options]) => options!)
    expect(first.sessionManager).not.toBe(second.sessionManager)
    expect(SessionManager.inMemory).toHaveBeenNthCalledWith(1, '/project-a')
    expect(SessionManager.inMemory).toHaveBeenNthCalledWith(2, '/project-b')
  })

  it('calls followUp (not prompt) when followUp=true', async () => {
    const piSession = {
      prompt:    vi.fn(),
      followUp:  vi.fn(() => Promise.resolve()),
      steer:     vi.fn(async () => {}),
      abort:     vi.fn(async () => {}),
      subscribe: vi.fn(() => () => {}),
    }
    vi.mocked(createAgentSession).mockResolvedValue({ session: piSession } as any)

    const factory = makePiSessionFactory({
      modelRuntime:   { getModel: vi.fn().mockReturnValue({ provider: 'google', id: 'flash' }) } as any,
      createSessionManager: () => ({} as any),
    })

    await factory('task', 'google/flash', '/cwd', true)

    expect(piSession.followUp).toHaveBeenCalledWith('task')
    expect(piSession.prompt).not.toHaveBeenCalled()
  })

  it('calls prompt (not followUp) when followUp=undefined', async () => {
    const piSession = {
      prompt:    vi.fn(() => Promise.resolve()),
      followUp:  vi.fn(),
      steer:     vi.fn(async () => {}),
      abort:     vi.fn(async () => {}),
      subscribe: vi.fn(() => () => {}),
    }
    vi.mocked(createAgentSession).mockResolvedValue({ session: piSession } as any)

    const factory = makePiSessionFactory({
      modelRuntime:   { getModel: vi.fn().mockReturnValue({ provider: 'google', id: 'flash' }) } as any,
      createSessionManager: () => ({} as any),
    })

    await factory('task', 'google/flash', '/cwd', undefined)

    expect(piSession.prompt).toHaveBeenCalledWith('task')
    expect(piSession.followUp).not.toHaveBeenCalled()
  })

  it('returns the session without blocking on prompt()', async () => {
    let resolvePrompt!: () => void
    const promptDone = new Promise<void>(r => { resolvePrompt = r })

    const piSession = {
      prompt:    vi.fn(() => promptDone),
      followUp:  vi.fn(() => promptDone),
      steer:     vi.fn(async () => {}),
      abort:     vi.fn(async () => {}),
      subscribe: vi.fn((_cb: (e: unknown) => void) => () => {}),
    }

    vi.mocked(createAgentSession).mockResolvedValue({ session: piSession } as any)

    const factory = makePiSessionFactory({
      modelRuntime:   { getModel: vi.fn().mockReturnValue({ provider: 'google', id: 'flash' }) } as any,
      createSessionManager: () => ({} as any),
    })

    // Fixed: resolves immediately without waiting for prompt().
    // Broken: hangs here because factory awaits promptDone, which never resolves.
    const session = await factory('do the thing', 'google/flash', '/cwd', undefined)

    expect(session).toBeDefined()
    expect(piSession.prompt).toHaveBeenCalledWith('do the thing')

    // Verify prompt is still in-flight (hasn't resolved)
    let promptCompleted = false
    promptDone.then(() => { promptCompleted = true })
    await Promise.resolve()
    expect(promptCompleted).toBe(false)

    resolvePrompt()
    await promptDone
  }, 500)
})
