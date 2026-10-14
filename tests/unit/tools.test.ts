import { describe, it, expect, vi } from 'vitest'
import { makeTools, TOOL_SCHEMAS } from '../../src/server/tools.js'
import type { ManagedAgents } from '../../src/server/managed-agents.js'

describe('the standalone asynchronous MCP interface', () => {
  const fixture = () => {
    const agents = Object.fromEntries(['spawn','continue','poll','wait','result','list','steer','followup','terminate','release']
      .map(name => [name, vi.fn(async args => ({ method: name, args }))])) as unknown as ManagedAgents
    const client = { listModels: vi.fn(async () => []) }
    return { agents, client, ...makeTools(agents, client) }
  }
  it('publishes exactly the 11 persistent orchestration tools with matching handlers', () => {
    const { tools } = fixture()
    expect(TOOL_SCHEMAS).toHaveLength(11)
    expect(TOOL_SCHEMAS.map(s => s.name).sort()).toEqual(Object.keys(tools).sort())
    expect(Object.keys(tools)).not.toContain('pi_run_task')
    expect(Object.keys(tools)).not.toContain('pi_delete_agent')
  })
  it.each([
    ['pi_spawn_agent','spawn'],['pi_continue_agent','continue'],['pi_poll_agent','poll'],
    ['pi_get_result','result'],['pi_list_agents','list'],['pi_steer_agent','steer'],
    ['pi_followup_agent','followup'],['pi_terminate_agent','terminate'],['pi_release_agent','release'],
  ])('routes %s without launching a separate temporary session', async (tool, method) => {
    const { tools, agents } = fixture()
    const args = { session_id: 'test-id', task: 'task', message: 'message' }
    const result = await (tools as any)[tool](args)
    expect(result).toEqual({ method, args })
    expect((agents as any)[method]).toHaveBeenCalledWith(args)
  })
  it('passes MCP cancellation through to the wait implementation', async () => {
    const { tools, agents } = fixture()
    const args = { session_id: 'test-id', timeout_ms: 300000 }
    const controller = new AbortController()
    await tools.pi_wait_agent(args, controller.signal)
    expect(agents.wait).toHaveBeenCalledWith(args, controller.signal)
  })
  it('lists models without spawning an agent', async () => {
    const { tools, agents, client } = fixture()
    expect(await tools.pi_list_models({})).toEqual({ models: [] })
    expect(client.listModels).toHaveBeenCalledOnce()
    expect(agents.spawn).not.toHaveBeenCalled()
  })
})
