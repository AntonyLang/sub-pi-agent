import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { makeSessionLogger } from '../../src/server/event-logger.js'

describe('makeSessionLogger', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'pi-events-test-'))
  })

  it('creates <sessionId>.jsonl with a start event', async () => {
    const logger = makeSessionLogger({
      sessionsDir: tmpDir,
      sessionId: 'abc123',
      task: 'write some code',
      model: 'google/gemini-2.0-flash',
    })
    await logger.end('')  // awaiting any write ensures start was serialized first

    const lines = (await readFile(join(tmpDir, 'abc123.jsonl'), 'utf8')).trim().split('\n')
    const start = JSON.parse(lines[0])
    expect(start.type).toBe('start')
    expect(start.sessionId).toBe('abc123')
    expect(start.task).toBe('write some code')
    expect(start.model).toBe('google/gemini-2.0-flash')
    expect(start.startedAt).toBeGreaterThan(0)
  })

  it('appends delta events with text and timestamp', async () => {
    const logger = makeSessionLogger({ sessionsDir: tmpDir, sessionId: 's1', task: 'x' })
    await logger.delta('hello ')
    await logger.delta('world')

    const lines = (await readFile(join(tmpDir, 's1.jsonl'), 'utf8')).trim().split('\n').map(l => JSON.parse(l))
    expect(lines[1]).toMatchObject({ type: 'delta', text: 'hello ' })
    expect(lines[2]).toMatchObject({ type: 'delta', text: 'world' })
    expect(typeof lines[1].ts).toBe('number')
  })

  it('appends end event with output and durationMs', async () => {
    const logger = makeSessionLogger({ sessionsDir: tmpDir, sessionId: 's2', task: 'x' })
    await logger.end('accumulated output')

    const lines = (await readFile(join(tmpDir, 's2.jsonl'), 'utf8')).trim().split('\n').map(l => JSON.parse(l))
    const end = lines[lines.length - 1]
    expect(end.type).toBe('end')
    expect(end.output).toBe('accumulated output')
    expect(end.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('appends error event with message, output, and durationMs', async () => {
    const logger = makeSessionLogger({ sessionsDir: tmpDir, sessionId: 's3', task: 'x' })
    await logger.error('400 provider rejected', 'partial out')

    const lines = (await readFile(join(tmpDir, 's3.jsonl'), 'utf8')).trim().split('\n').map(l => JSON.parse(l))
    const err = lines[lines.length - 1]
    expect(err.type).toBe('error')
    expect(err.message).toBe('400 provider rejected')
    expect(err.output).toBe('partial out')
    expect(err.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('creates sessionsDir recursively if it does not exist', async () => {
    const nestedDir = join(tmpDir, 'new', 'nested', 'dir')
    const logger = makeSessionLogger({ sessionsDir: nestedDir, sessionId: 'id1', task: 'x' })
    await logger.end('')

    const content = await readFile(join(nestedDir, 'id1.jsonl'), 'utf8')
    expect(content.length).toBeGreaterThan(0)
  })

  it('writes events in order: start → delta → end', async () => {
    const logger = makeSessionLogger({ sessionsDir: tmpDir, sessionId: 's4', task: 'x' })
    await logger.delta('chunk')
    await logger.end('chunk')

    const lines = (await readFile(join(tmpDir, 's4.jsonl'), 'utf8')).trim().split('\n').map(l => JSON.parse(l))
    expect(lines.map((l: { type: string }) => l.type)).toEqual(['start', 'delta', 'end'])
  })

  it('each line is valid JSON', async () => {
    const logger = makeSessionLogger({
      sessionsDir: tmpDir,
      sessionId: 's5',
      task: 'do stuff',
      model: 'anthropic/claude-sonnet-4-6',
    })
    await logger.delta('a')
    await logger.delta('b')
    await logger.end('ab')

    const raw = await readFile(join(tmpDir, 's5.jsonl'), 'utf8')
    const lines = raw.trim().split('\n')
    expect(lines).toHaveLength(4)
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow()
    }
  })

  it('omits model field when not provided', async () => {
    const logger = makeSessionLogger({ sessionsDir: tmpDir, sessionId: 's6', task: 'x' })
    await logger.end('')

    const lines = (await readFile(join(tmpDir, 's6.jsonl'), 'utf8')).trim().split('\n')
    const start = JSON.parse(lines[0])
    expect(Object.hasOwn(start, 'model')).toBe(false)
  })
})
