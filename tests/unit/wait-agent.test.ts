import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { waitForAgent } from '../../src/server/wait-agent.js'
import type { SessionStatus } from '../../src/server/types.js'

describe('wait for an actionable Pi state', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it.each(['done', 'needs_input', 'error', 'interrupted'] as const)('returns %s immediately without a timer or delivery body', async status => {
    expect(await waitForAgent(() => status)).toEqual({ status, timed_out: false,
      next: status === 'needs_input' ? 'pi_poll_agent' : 'pi_get_result' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stays inside the pending tool while running, then wakes on completion', async () => {
    let status: SessionStatus = 'running'
    const resolved = vi.fn()
    const promise = waitForAgent(() => status).then(result => { resolved(result); return result })
    await vi.advanceTimersByTimeAsync(1000)
    expect(resolved).not.toHaveBeenCalled()
    status = 'done'
    await vi.advanceTimersByTimeAsync(250)
    expect(await promise).toEqual({ status: 'done', timed_out: false, next: 'pi_get_result' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('wakes for a question and leaves reading/acknowledging it to poll', async () => {
    let status: SessionStatus = 'running'
    const promise = waitForAgent(() => status)
    status = 'needs_input'
    await vi.advanceTimersByTimeAsync(250)
    expect(await promise).toEqual({ status: 'needs_input', timed_out: false, next: 'pi_poll_agent' })
  })

  it('defaults to 3 minutes and reports timeout without altering the task', async () => {
    const read = vi.fn(() => 'running' as const)
    const resolved = vi.fn()
    const promise = waitForAgent(read).then(result => { resolved(result); return result })
    await vi.advanceTimersByTimeAsync(179_999)
    expect(resolved).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(await promise).toEqual({ status: 'running', timed_out: true, next: 'pi_wait_agent' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels the wait and clears its checks without touching the task', async () => {
    const controller = new AbortController()
    const read = vi.fn(() => 'running' as const)
    const promise = waitForAgent(read, 5000, controller.signal)
    const rejection = expect(promise).rejects.toThrow('stop waiting')
    controller.abort(new Error('stop waiting'))
    await rejection
    expect(vi.getTimerCount()).toBe(0)
    expect(read).toHaveBeenCalledTimes(1)
    expect(() => waitForAgent(read, 5000, controller.signal)).toThrow('stop waiting')
  })

  it('cleans up if the state reader fails while waiting', async () => {
    const read = vi.fn(() => 'running' as const)
    const promise = waitForAgent(read)
    const rejection = expect(promise).rejects.toThrow('unavailable')
    read.mockImplementation(() => { throw new Error('unavailable') })
    await vi.advanceTimersByTimeAsync(250)
    await rejection
    expect(vi.getTimerCount()).toBe(0)
  })

  it('accepts the 5 minute upper bound', async () => {
    const promise = waitForAgent(() => 'running', 300_000)
    await vi.advanceTimersByTimeAsync(300_000)
    expect(await promise).toEqual({ status: 'running', timed_out: true, next: 'pi_wait_agent' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([0, -1, 300_001, 1.5, NaN, Infinity])('rejects invalid timeout %s', value => {
    expect(() => waitForAgent(() => 'running', value)).toThrow('invalid_timeout')
    expect(vi.getTimerCount()).toBe(0)
  })
})
