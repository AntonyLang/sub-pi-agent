import type { PiClient } from './types.js'
import type { ManagedAgents, SpawnAgentInput } from './managed-agents.js'
import type { AgentStatus } from './agent-repository.js'
import type { WaitAgentInput } from './wait-agent.js'

// `model` is optional on spawn/continue. Omitted, the model is resolved per task from
// the user's current Pi settings — never cached here, so a settings change applies to the next task.
type SpawnParams     = SpawnAgentInput
type SessionIdParam  = { session_id: string }
type SteerParams     = SessionIdParam & { message: string }

// pi_steer_agent result. `status: 'queued'` means only that Pi accepted the message for delivery
// once the current assistant turn finishes its tool calls — never that it was delivered or acted on.
type SteerResult =
  | { ok: true;  message: string; status: 'queued' }
  | { ok: false; message: string; status: 'rejected'; reason: string }


// Each tool input schema — used by index.ts for MCP registration
export const TOOL_SCHEMAS = [
  {
    name: 'pi_list_models',
    description: 'List Pi models available for this session with tier labels (fast/balanced/frontier).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'pi_spawn_agent',
    description: 'Start a named Pi agent asynchronously. Returns identity/status, not a completed result. Continue independent work; when idle, call pi_wait_agent instead of repeatedly polling. pi_poll_agent reads progress or a needs_input question; answer through pi_continue_agent on the same ID. Read final delivery with pi_get_result once done. Unread events may accompany any tool response; no live notifications. Use pi_list_agents for reuse. Omit model to follow Pi settings.',
    inputSchema: {
      type: 'object',
      properties: {
        task:  { type: 'string', description: 'Task description for the Pi agent' },
        model: { type: 'string', description: 'Optional model key in "provider/model-id" format (e.g. anthropic/claude-sonnet-4-6, openai/gpt-4o). Omit to use the model resolved from the user\'s current Pi settings default (read per task, so a settings change applies to the next spawn). Pass an explicit model to override it.' },
        cwd:   { type: 'string', description: 'Absolute task/project working directory. Pass it explicitly when the MCP client starts servers outside the project.' },
        name: { type: 'string', description: 'Optional human-readable agent name; generated when omitted.' },
        description: { type: 'string', description: 'Optional short description to help identify and reuse this agent.' },
      },
      required: ['task'],
    },
  },
  {
    name: 'pi_steer_agent',
    description: 'Queue a steering message for a running Pi agent. Returns the message verbatim plus a delivery status: {ok:true,message,status:"queued"} means only that Pi accepted it for delivery after the current assistant turn finishes its tool calls — it does NOT mean the message was delivered or that Pi has responded. {ok:false,message,status:"rejected",reason} means nothing was sent (unknown session, session not running, or Pi refused the steer). Use pi_followup_agent to queue a message for after all work is finished.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string' },
        message:    { type: 'string' },
      },
      required: ['session_id', 'message'],
    },
  },
  {
    name: 'pi_followup_agent',
    description: 'Queue a follow-up message for a spawned Pi agent. Delivered only after the agent finishes all work. Use this when you do not want to interrupt the agent at all.',
    inputSchema: {
      type: 'object',
      properties: {
        session_id: { type: 'string' },
        message:    { type: 'string' },
      },
      required: ['session_id', 'message'],
    },
  },
  {
    name: 'pi_poll_agent',
    description: 'Immediately read latest assistant text, compact activity metadata and any pending question, without reasoning text or raw tool records. output can stay unchanged while Pi thinks or runs tools; activity shows the latest phase/tool and its update time. needs_input returns question {id,text}: answer via pi_continue_agent on the same ID. Reading a question acknowledges its reminder; polling does not acknowledge final delivery. When idle, use pi_wait_agent instead of repeatedly polling.',
    inputSchema: {
      type: 'object',
      properties: { session_id: { type: 'string' } },
      required: ['session_id'],
    },
  },
  {
    name: 'pi_wait_agent',
    description: 'When no independent work remains, wait for this agent to need input, finish, fail or be interrupted. The MCP process waits without calling a model; progress changes alone do not wake it. Already actionable states return immediately. Returns {status,timed_out,next}; no progress, question or delivery body, and no event acknowledgement. On timeout Pi keeps running: wait again or inspect progress. Read questions with pi_poll_agent and final delivery with pi_get_result. Cancelling the wait does not stop Pi.',
    inputSchema: { type: 'object', properties: {
      session_id: { type: 'string' },
      timeout_ms: { type: 'integer', minimum: 1, maximum: 300000, default: 180000,
        description: 'Maximum wait in milliseconds (default 180000 / 3 minutes, max 300000 / 5 minutes). The MCP client tool timeout must exceed this duration. A timeout does not stop the agent.' },
    }, required: ['session_id'] },
  },
  {
    name: 'pi_get_result',
    description: 'Read final delivery, without waiting: done returns the last Pi reply, error/interrupted returns the final partial reply and error in the JSON body. Before final delivery exists, returns only {ready:false,reason,next}, never progress or a question body; use pi_poll_agent. Reading final delivery acknowledges its unread event. Results remain readable after release or MCP restart.',
    inputSchema: {
      type: 'object',
      properties: { session_id: { type: 'string' } },
      required: ['session_id'],
    },
  },
  {
    name: 'pi_list_agents',
    description: 'List only this MCP registry, including unloaded recoverable agents. Compact identity/status metadata, no transcript. active means running; needs_input means Pi handed back a question: poll it, then continue the same ID with an answer. Listed agents become eligible for this connection\'s unread event reminders. Does not refresh idle timers.',
    inputSchema: { type: 'object', properties: {
      status: { type: 'string', enum: ['active', 'needs_input', 'done', 'error', 'interrupted'] },
      cwd: { type: 'string', description: 'Optional absolute project directory filter.' },
    } },
  },
  {
    name: 'pi_continue_agent',
    description: 'Continue a registered agent by explicit ID, retaining its Pi conversation/tool context. For needs_input, pass the answer as task; otherwise pass the next assignment. Returns identity/status immediately. Do independent work or use pi_wait_agent when idle; pi_poll_agent inspects progress/questions and pi_get_result reads final delivery. Restores released sessions after MCP restart, rejects running agents, never imports arbitrary Pi CLI sessions. Omit model to follow current Pi settings.',
    inputSchema: { type: 'object', properties: {
      session_id: { type: 'string' }, task: { type: 'string' }, model: { type: 'string', description: 'Optional explicit override; omitted uses current Pi default.' },
    }, required: ['session_id', 'task'] },
  },
  {
    name: 'pi_release_agent',
    description: 'Unload an idle agent runtime and release its write lease, retaining its name, description, results and native Pi session on disk for later continuation. Rejects busy agents. Does not delete the agent or its context.',
    inputSchema: { type: 'object', properties: { session_id: { type: 'string' } }, required: ['session_id'] },
  },
  {
    name: 'pi_terminate_agent',
    description: 'Stop the current task, mark it interrupted, and return its partial latest reply. Retains the registered agent and context for explicit continuation; use pi_release_agent to unload an idle runtime.',
    inputSchema: {
      type: 'object',
      properties: { session_id: { type: 'string' } },
      required: ['session_id'],
    },
  },
] as const

export const makeTools = (agents: ManagedAgents, client: Pick<PiClient, 'listModels'>) => ({
  schemas: TOOL_SCHEMAS,
  tools: {
    pi_list_models: async (_args: Record<string, unknown>) => ({ models: await client.listModels() }),
    pi_spawn_agent: async (args: SpawnParams) => agents.spawn(args),
    pi_continue_agent: async (args: SessionIdParam & { task: string; model?: string }) => agents.continue(args),
    pi_poll_agent: async (args: SessionIdParam) => agents.poll(args),
    pi_wait_agent: async (args: WaitAgentInput, signal?: AbortSignal) => agents.wait(args, signal),
    pi_get_result: async (args: SessionIdParam) => agents.result(args),
    pi_list_agents: async (args: { status?: AgentStatus; cwd?: string }) => agents.list(args),
    pi_steer_agent: async (args: SteerParams): Promise<SteerResult> => agents.steer(args) as Promise<SteerResult>,
    pi_followup_agent: async (args: SteerParams) => agents.followup(args),
    pi_terminate_agent: async (args: SessionIdParam) => agents.terminate(args),
    pi_release_agent: async (args: SessionIdParam) => agents.release(args),
  },
})
