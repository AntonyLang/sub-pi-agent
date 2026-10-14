import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { makeSessionStore } from '../../src/server/session-store.js'
import type { SessionEntry, ActiveSession } from '../../src/server/types.js'

const mockSession: ActiveSession = {
  steer: vi.fn(),
  abort: vi.fn(),
  subscribe: vi.fn(() => () => {}),
}

const entry = (overrides: Partial<SessionEntry> = {}): SessionEntry => ({
  session: mockSession,
  output: '',
  status: 'running',
  createdAt: Date.now(),
  ...overrides,
})

describe('makeSessionStore', () => {
  it('adds and retrieves an entry', () => {
    const store = makeSessionStore()
    store.add('a', entry())
    expect(store.get('a')).toBeDefined()
    store.dispose()
  })

  it('returns undefined for unknown id', () => {
    const store = makeSessionStore()
    expect(store.get('missing')).toBeUndefined()
    store.dispose()
  })

  it('updates output and status without mutating the original entry', () => {
    const store = makeSessionStore()
    const original = entry({ output: 'hello' })
    store.add('a', original)
    store.update('a', { output: 'hello world', status: 'done' })
    expect(store.get('a')?.output).toBe('hello world')
    expect(store.get('a')?.status).toBe('done')
    expect(original.output).toBe('hello')   // original unchanged
    store.dispose()
  })

  it('does nothing on update for unknown id', () => {
    const store = makeSessionStore()
    expect(() => store.update('nope', { status: 'done' })).not.toThrow()
    store.dispose()
  })

  it('removes an entry', () => {
    const store = makeSessionStore()
    store.add('a', entry())
    store.remove('a')
    expect(store.get('a')).toBeUndefined()
    store.dispose()
  })

  it('all() returns a ReadonlyMap of current entries', () => {
    const store = makeSessionStore()
    store.add('a', entry())
    store.add('b', entry())
    expect(store.all().size).toBe(2)
    store.dispose()
  })

  it('prunes entries older than ttlMs when cleanup fires', () => {
    vi.useFakeTimers()
    const now = Date.now()
    const store = makeSessionStore({ ttlMs: 1000, cleanupIntervalMs: 500 })

    store.add('stale', entry({ createdAt: now - 2000, status: 'done' }))
    store.add('active', entry({ createdAt: now - 2000 }))
    store.add('fresh', entry({ createdAt: now }))

    vi.advanceTimersByTime(500)  // trigger cleanup interval

    expect(store.get('stale')).toBeUndefined()
    expect(store.get('fresh')).toBeDefined()
    expect(store.get('active')).toBeDefined()

    store.dispose()
    vi.useRealTimers()
  })

  it('respects PI_SESSION_TTL_MS env var', () => {
    process.env.PI_SESSION_TTL_MS = '60000'
    const store = makeSessionStore()
    // just verify it constructs without error
    store.dispose()
    delete process.env.PI_SESSION_TTL_MS
  })

  it('onChange called on add', () => {
    const onChange = vi.fn()
    const store = makeSessionStore({ onChange })
    store.add('a', entry())
    expect(onChange).toHaveBeenCalledTimes(1)
    store.dispose()
  })

  it('onChange called on update', () => {
    const onChange = vi.fn()
    const store = makeSessionStore({ onChange })
    store.add('a', entry())
    onChange.mockClear()
    store.update('a', { status: 'done' })
    expect(onChange).toHaveBeenCalledTimes(1)
    store.dispose()
  })

  it('onChange called on remove', () => {
    const onChange = vi.fn()
    const store = makeSessionStore({ onChange })
    store.add('a', entry())
    onChange.mockClear()
    store.remove('a')
    expect(onChange).toHaveBeenCalledTimes(1)
    store.dispose()
  })

  it('onChange NOT called on dispose', () => {
    const onChange = vi.fn()
    const store = makeSessionStore({ onChange })
    store.add('a', entry())
    onChange.mockClear()
    store.dispose()
    expect(onChange).not.toHaveBeenCalled()
  })
})
