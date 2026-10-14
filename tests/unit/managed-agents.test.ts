import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, symlinkSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { AgentRepository, type AgentRecord } from '../../src/server/agent-repository.js'
import { ManagedAgents } from '../../src/server/managed-agents.js'
import { makePiSessionAdapter } from '../../src/server/pi-client.js'
import { makeSessionStore } from '../../src/server/session-store.js'
import { makeTools } from '../../src/server/tools.js'
import { makeMcpResponse } from '../../src/server/mcp-response.js'
import type { ManagedFactory } from '../../src/server/managed-session.js'

describe('managed agents with native Pi session persistence', () => {
  let dir: string
  let now: number
  const services: ManagedAgents[] = []
  const stores: ReturnType<typeof makeSessionStore>[] = []
  const pending: Array<() => void> = []
  const emitters: Array<(event: unknown) => void> = []
  const factoryCalls: Array<{ sessionFile?: string; model?: string; history: unknown[] }> = []
  let disposed: number

  // Deterministic fake model, real SDK transcript storage and the production event adapter.
  const factory: ManagedFactory = async options => {
    const manager = options.sessionFile
      ? SessionManager.open(options.sessionFile, options.sessionDir, options.cwd)
      : SessionManager.create(options.cwd, options.sessionDir)
    const history = manager.buildSessionContext().messages
    factoryCalls.push({ sessionFile: options.sessionFile, model: options.model, history })
    let listener: (event: unknown) => void = () => {}
    const emit = (event: unknown) => listener(event)
    emitters.push(emit)
    const session = makePiSessionAdapter({
      subscribe(cb) { listener = cb; return () => {} },
      async steer(text) { if (text === 'reject') throw new Error('SDK refused') },
      async followUp() {}, async abort() { emit({ type: 'agent_end' }) },
    })
    const delta = (text: string) => emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: text } })
    return {
      session, sessionFile: manager.getSessionFile()!, modelKey: options.model ?? 'test/current-default',
      dispose() { disposed++ },
      async start(task) {
        manager.appendMessage({ role: 'user', content: task, timestamp: Date.now() })
        if (task === 'reject-start') throw new Error('Prompt failed before events')
        if (task === 'hold') await new Promise<void>(resolve => pending.push(resolve))
        if (task === 'ask') options.onQuestion('Which target branch should I use?')
        if (task === 'ask-without-text') {
          options.onQuestion('Which target branch should I use?')
          emit({ type: 'agent_end' }); return
        }
        const reply = task === 'recall' ? JSON.stringify(history) : `final:${task}`
        emit({ type: 'message_start', message: { role: 'assistant' } }); delta('checking');
        emit({ type: 'message_end', message: { role: 'assistant' } })
        emit({ type: 'message_start', message: { role: 'toolResult' } })
        emit({ type: 'message_end', message: { role: 'toolResult' } })
        emit({ type: 'message_start', message: { role: 'assistant' } })
        delta(reply.slice(0, 3)); delta(reply.slice(3))
        manager.appendMessage({ role: 'assistant', content: [{ type: 'text', text: reply }], timestamp: Date.now(),
          api: 'openai-completions', provider: 'test', model: 'test', stopReason: 'stop',
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } as never)
        emit({ type: 'message_end', message: { role: 'assistant' } }); emit({ type: 'agent_end' })
      },
    }
  }
  const service = (root = join(dir, 'agents'), customFactory = factory) => {
    const store = makeSessionStore({ ttlMs: Infinity }); stores.push(store)
    const agents = new ManagedAgents(new AgentRepository(root), customFactory, store, { now: () => now })
    services.push(agents); return agents
  }
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pi-managed-test-')); now = Date.now(); disposed = 0; factoryCalls.length = 0; emitters.length = 0 })
  afterEach(async () => {
    for (const agents of services.splice(0)) await agents.close()
    for (const resolve of pending.splice(0)) resolve()
    for (const store of stores.splice(0)) store.dispose()
    rmSync(dir, { recursive: true, force: true })
  })

  it('names and lists agents with status/cwd filters; reads do not refresh idle activity', async () => {
    const agents = service()
    const a = await agents.spawn({ task: 'one', name: 'builder', description: 'Build project', cwd: dir })
    expect(a).toMatchObject({ name: 'builder', description: 'Build project' })
    expect(await agents.result(a)).toEqual({ status: 'done', output: 'final:one' })
    await agents.spawn({ task: 'hold', name: 'worker', cwd: join(dir, 'other') })
    expect(agents.list({ status: 'done', cwd: dir }).agents.map(a => a.name)).toEqual(['builder'])
    expect(agents.list({ status: 'active' }).agents.map(a => a.name)).toEqual(['worker'])
    const previous = agents.list({ status: 'done' }).agents[0].lastActivityAt
    now += 5000; agents.poll(a); agents.list()
    expect(agents.list({ status: 'done' }).agents[0].lastActivityAt).toBe(previous)
  })

  it('keeps the ID and native context over release, MCP reconstruction and an explicit continuation', async () => {
    const first = service()
    const a = await first.spawn({ task: 'remember:secret-327', name: 'continuity', cwd: dir })
    expect(await first.result(a)).toEqual({ status: 'done', output: 'final:remember:secret-327' })
    expect(first.release(a)).toMatchObject({ recoverable: true })
    expect(first.list().agents[0].loaded).toBe(false)
    expect(await first.result(a)).toEqual({ status: 'done', output: 'final:remember:secret-327' })
    await first.close()
    const second = service()
    expect(second.list().agents[0]).toMatchObject({ session_id: a.session_id, name: 'continuity', status: 'done', loaded: false })
    const next = await second.continue({ ...a, task: 'recall' })
    expect(next.session_id).toBe(a.session_id)
    expect((await second.result(a)).output).toContain('remember:secret-327')
    expect(factoryCalls[1].sessionFile).toBeDefined()
    expect(factoryCalls[1].model).toBeUndefined() // default is resolved for each new task by the factory
  })

  it('declines an early result read without progress, then exposes the final reply', async () => {
    const agents = service()
    const a = await agents.spawn({ task: 'old', cwd: dir })
    await agents.result(a)
    await agents.continue({ ...a, task: 'hold', model: 'test/override' })
    expect(agents.poll(a)).toEqual({ status: 'running', output: '' })
    expect(await agents.result(a)).toEqual({ ready: false, reason: 'task_running', next: 'pi_poll_agent' })
    pending.pop()!()
    await Promise.resolve()
    expect(await agents.result(a)).toEqual({ status: 'done', output: 'final:hold' })
    expect(agents.poll(a)).toEqual({ status: 'done', output: 'final:hold' })
    expect(factoryCalls[1].model).toBe('test/override')
  })

  it('never unloads active tasks; unloads idle tasks after 60 minutes without deleting results/context', async () => {
    const agents = service()
    const a = await agents.spawn({ task: 'idle', cwd: dir })
    const b = await agents.spawn({ task: 'hold', cwd: dir })
    now += 60 * 60 * 1000; agents.poll(a); agents.sweep()
    expect(agents.list().agents.find(x => x.session_id === a.session_id)?.loaded).toBe(false)
    expect(agents.list().agents.find(x => x.session_id === b.session_id)?.loaded).toBe(true)
    expect(await agents.result(a)).toEqual({ status: 'done', output: 'final:idle' })
    expect(disposed).toBe(1)
    await agents.continue({ ...a, task: 'reused' })
    expect(await agents.result(a)).toEqual({ status: 'done', output: 'final:reused' })
  })

  it('rejects busy continue/release and returns steer text and real queue failures', async () => {
    const agents = service()
    const a = await agents.spawn({ task: 'hold', cwd: dir })
    await expect(agents.continue({ ...a, task: 'too early' })).rejects.toThrow('agent_busy')
    expect(() => agents.release(a)).toThrow('agent_busy')
    expect(await agents.steer({ ...a, message: '  keep this\n' })).toEqual({ ok: true, message: '  keep this\n', status: 'queued' })
    expect(await agents.steer({ ...a, message: 'reject' })).toMatchObject({ ok: false, message: 'reject', status: 'rejected' })
  })

  it('does not let a second MCP overwrite a loaded agent, and allows it after release', async () => {
    const first = service(); const second = service()
    const a = await first.spawn({ task: 'one', cwd: dir })
    expect(second.list().agents[0].status).toBe('done')
    await expect(second.continue({ ...a, task: 'two' })).rejects.toThrow('agent_busy')
    expect(() => second.release(a)).toThrow('agent_busy')
    first.release(a)
    await second.continue({ ...a, task: 'two' })
    expect(await second.result(a)).toEqual({ status: 'done', output: 'final:two' })
  })

  it('marks disconnected work interrupted, does not replay it, and permits an explicit new task', async () => {
    const first = service()
    const a = await first.spawn({ task: 'hold', cwd: dir })
    await first.close()
    const second = service()
    expect(second.list().agents[0]).toMatchObject({ status: 'interrupted', loaded: false })
    expect(await second.result(a)).toMatchObject({ status: 'interrupted', error: expect.any(String) })
    expect(factoryCalls).toHaveLength(1)
    await second.continue({ ...a, task: 'recover' })
    expect(await second.result(a)).toEqual({ status: 'done', output: 'final:recover' })
  })

  it('recognizes a crashed owner and reclaims only its dead lease', async () => {
    const first = service()
    const a = await first.spawn({ task: 'one', cwd: dir }); first.release(a)
    const repo = first.repository
    const r = repo.read(a.session_id); r.status = 'active'; repo.save(r)
    const lock = join(repo.directory(a.session_id), 'runtime.lock'); mkdirSync(lock)
    // An empty/partially written owner file is recoverable too: identity is in its name.
    const token = randomUUID(); writeFileSync(join(lock, `2147483647-${token}.json`), '')
    const second = service()
    expect(second.list().agents[0].status).toBe('interrupted')
    await second.continue({ ...a, task: 'recover' })
    expect(await second.result(a)).toEqual({ status: 'done', output: 'final:recover' })
  })

  it('excludes unrelated Pi CLI sessions and rejects unknown IDs and tampered paths', async () => {
    const agents = service()
    const unrelated = SessionManager.create(dir, join(dir, 'cli'))
    unrelated.appendMessage({ role: 'user', content: 'not managed', timestamp: Date.now() })
    expect(agents.list().agents).toHaveLength(0)
    await expect(agents.continue({ session_id: unrelated.getSessionId(), task: 'import' })).rejects.toThrow('agent_not_found')
    const a = await agents.spawn({ task: 'one', cwd: dir }); agents.release(a)
    const r = agents.repository.read(a.session_id)
    r.sessionFile = '../cli/external.jsonl'; agents.repository.save(r)
    await expect(agents.continue({ ...a, task: 'escape' })).rejects.toThrow('invalid_agent_path')
    expect(factoryCalls).toHaveLength(1)
  })

  it('rejects session directories linked outside the private agent folder', async () => {
    const agents = service()
    const a = await agents.spawn({ task: 'one', cwd: dir }); agents.release(a)
    const sessionDir = agents.repository.sessionDirectory(a.session_id)
    const external = join(dir, 'external'); mkdirSync(external)
    rmSync(sessionDir, { recursive: true }) // only this test fixture's native session folder
    symlinkSync(external, sessionDir, process.platform === 'win32' ? 'junction' : 'dir')
    await expect(agents.continue({ ...a, task: 'escape' })).rejects.toThrow('invalid_agent_path')
  })

  it('propagates start errors instead of leaving get_result running forever', async () => {
    const agents = service()
    const a = await agents.spawn({ task: 'reject-start', cwd: dir })
    expect(await agents.result(a)).toMatchObject({ status: 'error', error: expect.stringContaining('Prompt failed before events') })
    expect(agents.list({ status: 'error' }).agents).toHaveLength(1)
  })

  it('reports an intercepted prompt with no text instead of returning empty success or waiting forever', async () => {
    const agents = service(join(dir, 'empty'), async options => ({ ...await factory(options), async start() {} }))
    const a = await agents.spawn({ task: 'handled by an extension', cwd: dir })
    expect(await agents.result(a)).toMatchObject({ status: 'error', error: expect.stringContaining('without a text reply') })
  })

  it('interrupts and releases every agent even if one SDK abort throws during shutdown', async () => {
    const agents = service(join(dir, 'abort-errors'), async options => {
      const handle = await factory(options)
      return { ...handle, session: { ...handle.session, async abort() { throw new Error('abort hook failed') } } }
    })
    await agents.spawn({ task: 'hold', cwd: dir })
    await agents.spawn({ task: 'hold', cwd: dir })
    await agents.close()
    expect(agents.list().agents.map(a => [a.status, a.loaded])).toEqual([['interrupted', false], ['interrupted', false]])
  })

  it('routes the public tool handlers to the persistent implementation', async () => {
    const agents = service()
    const store = makeSessionStore(); stores.push(store)
    const { tools, schemas } = makeTools(agents, { listModels: vi.fn() })
    const a = await tools.pi_spawn_agent({ task: 'public', name: 'named', description: 'visible', cwd: dir })
    expect(await tools.pi_wait_agent(a)).toEqual({ status: 'done', timed_out: false, next: 'pi_get_result' })
    expect(await tools.pi_get_result(a)).toEqual({ status: 'done', output: 'final:public' })
    expect((await tools.pi_list_agents({ status: 'done' })).agents[0]).toMatchObject({ name: 'named', description: 'visible' })
    await tools.pi_release_agent(a)
    await tools.pi_continue_agent({ ...a, task: 'again' })
    expect(await tools.pi_get_result(a)).toEqual({ status: 'done', output: 'final:again' })
    expect(schemas.map(s => s.name)).not.toContain('pi_delete_agent')
    expect(schemas.map(s => s.name)).toContain('pi_wait_agent')
  })

  it('shows current activity while keeping the latest explicit text and final-result contract', async () => {
    const agents = service()
    const a = await agents.spawn({ task: 'hold', cwd: dir })
    const emit = emitters.at(-1)!
    emit({ type: 'message_start', message: { role: 'assistant' } })
    emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Working.' } })
    emit({ type: 'message_end', message: { role: 'assistant' } })
    emit({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'private reasoning' } })
    expect(agents.poll(a)).toMatchObject({ status: 'running', output: 'Working.', activity: { phase: 'thinking' } })
    emit({ type: 'tool_execution_start', toolName: 'bash', args: { command: 'private command' } })
    expect(agents.poll(a)).toMatchObject({ status: 'running', output: 'Working.', activity: { phase: 'tool_running', tool_name: 'bash' } })
    expect(JSON.stringify(agents.poll(a))).not.toContain('private')
    expect(await agents.result(a)).toEqual({ ready: false, reason: 'task_running', next: 'pi_poll_agent' })
    const waiting = agents.wait({ ...a, timeout_ms: 2000 })
    pending.pop()!()
    expect(await waiting).toEqual({ status: 'done', timed_out: false, next: 'pi_get_result' })
    expect(agents.unreadEvents()).toHaveProperty('events')
    expect(await agents.result(a)).toEqual({ status: 'done', output: 'final:hold' })
  })

  it('waits for another MCP owner without taking its lease or consuming its question', async () => {
    const owner = service(), reader = service()
    const a = await owner.spawn({ task: 'hold', cwd: dir })
    const previous = reader.list().agents[0].lastActivityAt
    expect(await reader.wait({ ...a, timeout_ms: 1 })).toEqual({ status: 'running', timed_out: true, next: 'pi_wait_agent' })
    expect(reader.list().agents[0].lastActivityAt).toBe(previous)
    const waiting = reader.wait({ ...a, timeout_ms: 2000 })
    pending.pop()!()
    expect(await waiting).toMatchObject({ status: 'done', timed_out: false })
    await owner.continue({ ...a, task: 'ask' })
    expect(await reader.wait(a)).toEqual({ status: 'needs_input', timed_out: false, next: 'pi_poll_agent' })
    expect(reader.unreadEvents()).toHaveProperty('events')
    expect(reader.poll(a)).toHaveProperty('question')
    expect(reader.unreadEvents()).toEqual({})
  })

  it('hands a structured question back, preserves it over unload/restart, and continues the same context', async () => {
    const first = service()
    const a = await first.spawn({ task: 'ask-without-text', cwd: dir, name: 'questioner' })
    expect(first.list({ status: 'needs_input' }).agents).toHaveLength(1)
    expect(first.unreadEvents()).toMatchObject({ events: [{ type: 'needs_input', session_id: a.session_id, next_tool: 'pi_poll_agent' }] })
    expect(await first.result(a)).toEqual({ ready: false, reason: 'needs_input', next: 'pi_poll_agent' })
    first.release(a); await first.close()
    const second = service()
    expect(second.unreadEvents()).toEqual({}) // unobserved agents do not intrude into another connection
    second.list({ status: 'needs_input' })
    expect(second.unreadEvents()).toHaveProperty('events')
    const p = second.poll(a)
    expect(p).toMatchObject({ status: 'needs_input', question: { id: expect.any(String), text: 'Which target branch should I use?' } })
    expect(second.unreadEvents()).toEqual({})
    expect(second.poll(a).question).toEqual(p.question) // acknowledged is not answered
    await second.continue({ ...a, task: 'recall' })
    expect((await second.result(a)).output).toContain('ask-without-text')
    expect(second.poll(a)).not.toHaveProperty('question')
  })

  it('attaches compact persistent reminders to ordinary and error responses until the body is read', async () => {
    const first = service()
    const a = await first.spawn({ task: 'one', cwd: dir })
    const response = makeMcpResponse(first, { models: [] })
    expect(response.structuredContent).toMatchObject({ models: [], events: [{ session_id: a.session_id, type: 'done', next_tool: 'pi_get_result' }] })
    expect(JSON.parse(response.content[0].text)).toEqual(response.structuredContent)
    expect(response.structuredContent.events?.[0]).not.toHaveProperty('output')
    expect(response.structuredContent.events?.[0]).not.toHaveProperty('question')
    const failedCall = makeMcpResponse(first, { error: 'unknown session' }, true)
    expect(failedCall.isError).toBe(true)
    expect(failedCall.structuredContent).toHaveProperty('events')
    first.poll(a)
    expect(makeMcpResponse(first, { ok: true }).structuredContent).toHaveProperty('events') // final body still unread
    first.release(a); await first.close()
    const second = service(); second.list()
    expect(second.unreadEvents()).toHaveProperty('events')
    await second.result(a)
    expect(makeMcpResponse(second, { models: [] }).structuredContent).toEqual({ models: [] })
    second.release(a); await second.close()
    const third = service(); third.list()
    expect(third.unreadEvents()).toEqual({}) // read receipt survives restart
    await third.continue({ ...a, task: 'two' })
    expect(third.unreadEvents()).toMatchObject({ events: [{ generation: 2, type: 'done' }] })
  })

  it('acknowledges an event without overwriting another MCP owner or a later generation', async () => {
    const owner = service()
    const a = await owner.spawn({ task: 'one', cwd: dir })
    const reader = service(); reader.list(); await reader.result(a)
    expect(owner.unreadEvents()).toEqual({})
    await owner.continue({ ...a, task: 'two' })
    expect(reader.unreadEvents()).toMatchObject({ events: [{ generation: 2, type: 'done' }] })
    owner.release(a)
    expect(owner.repository.read(a.session_id).generation).toBe(2)
  })

  it('bounds reminders while leaving all unread bodies recoverable', async () => {
    const agents = service()
    for (let i = 0; i < 11; i++) await agents.spawn({ task: `task-${i}`, cwd: dir })
    const notices = agents.unreadEvents()
    expect(notices.events).toHaveLength(10); expect(notices.remaining_events).toBe(1)
    await agents.result({ session_id: notices.events![0].session_id })
    expect(agents.unreadEvents().events).toHaveLength(10)
    expect(agents.unreadEvents()).not.toHaveProperty('remaining_events')
  })
})
