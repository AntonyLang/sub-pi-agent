import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { makeSessionStore } from '../../src/server/session-store.js'
import { makeStatusWriter } from '../../src/server/status-writer.js'
import type { ActiveSession } from '../../src/server/types.js'

const mockSession = (): ActiveSession => ({
  steer: vi.fn(),
  abort: vi.fn(),
  subscribe: vi.fn(() => () => {}),
})

describe('makeStatusWriter', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'pi-status-test-'))
  })

  it('creates status.json with zero running when store is empty', async () => {
    const store = makeSessionStore()
    const write = makeStatusWriter({ statusDir: tmpDir, store })

    await write()

    const raw = await readFile(join(tmpDir, 'status.json'), 'utf8')
    const data = JSON.parse(raw)
    expect(data.running).toBe(0)
    expect(data.models).toEqual([])
    expect(data.totalOutputBytes).toBe(0)
    store.dispose()
  })

  it('reflects running sessions in status.json', async () => {
    const store = makeSessionStore()
    store.add('s1', {
      session: mockSession(),
      output: 'hello world',
      status: 'running',
      createdAt: Date.now(),
      model: 'google/gemini-2.0-flash',
    })
    store.add('s2', {
      session: mockSession(),
      output: 'foo',
      status: 'running',
      createdAt: Date.now(),
      model: 'google/gemini-2.5-pro',
    })

    const write = makeStatusWriter({ statusDir: tmpDir, store })
    await write()

    const data = JSON.parse(await readFile(join(tmpDir, 'status.json'), 'utf8'))
    expect(data.running).toBe(2)
    expect(data.models).toContain('gemini-2.0-flash')
    expect(data.models).toContain('gemini-2.5-pro')
    store.dispose()
  })

  it('excludes done and error sessions from running count and models', async () => {
    const store = makeSessionStore()
    store.add('s1', {
      session: mockSession(),
      output: 'done output',
      status: 'done',
      createdAt: Date.now(),
      model: 'google/gemini-2.0-flash',
    })
    store.add('s2', {
      session: mockSession(),
      output: 'err output',
      status: 'error',
      createdAt: Date.now(),
      model: 'google/gemini-2.5-pro',
    })

    const write = makeStatusWriter({ statusDir: tmpDir, store })
    await write()

    const data = JSON.parse(await readFile(join(tmpDir, 'status.json'), 'utf8'))
    expect(data.running).toBe(0)
    expect(data.models).toEqual([])
    store.dispose()
  })

  it('counts total output bytes across all sessions regardless of status', async () => {
    const store = makeSessionStore()
    store.add('s1', { session: mockSession(), output: 'abc', status: 'running', createdAt: Date.now() })
    store.add('s2', { session: mockSession(), output: 'de', status: 'done', createdAt: Date.now() })

    const write = makeStatusWriter({ statusDir: tmpDir, store })
    await write()

    const data = JSON.parse(await readFile(join(tmpDir, 'status.json'), 'utf8'))
    expect(data.totalOutputBytes).toBe(5)  // 3 + 2
    store.dispose()
  })

  it('strips provider prefix from model keys', async () => {
    const store = makeSessionStore()
    store.add('s1', {
      session: mockSession(),
      output: '',
      status: 'running',
      createdAt: Date.now(),
      model: 'anthropic/claude-sonnet-4-6',
    })

    const write = makeStatusWriter({ statusDir: tmpDir, store })
    await write()

    const data = JSON.parse(await readFile(join(tmpDir, 'status.json'), 'utf8'))
    expect(data.models).toEqual(['claude-sonnet-4-6'])
    store.dispose()
  })

  it('concurrent writes each produce valid JSON (atomic write)', async () => {
    const store = makeSessionStore()
    const write = makeStatusWriter({ statusDir: tmpDir, store })

    await Promise.all([write(), write(), write()])

    const raw = await readFile(join(tmpDir, 'status.json'), 'utf8')
    expect(() => JSON.parse(raw)).not.toThrow()
    store.dispose()
  })

  it('leaves no .tmp files after a successful write', async () => {
    const store = makeSessionStore()
    const write = makeStatusWriter({ statusDir: tmpDir, store })

    await write()

    const files = await readdir(tmpDir)
    expect(files.filter(f => f.endsWith('.tmp'))).toHaveLength(0)
    store.dispose()
  })

  it('includes updatedAt timestamp in status.json', async () => {
    const before = Date.now()
    const store = makeSessionStore()
    const write = makeStatusWriter({ statusDir: tmpDir, store })

    await write()

    const data = JSON.parse(await readFile(join(tmpDir, 'status.json'), 'utf8'))
    expect(data.updatedAt).toBeGreaterThanOrEqual(before)
    expect(data.updatedAt).toBeLessThanOrEqual(Date.now())
    store.dispose()
  })
})
