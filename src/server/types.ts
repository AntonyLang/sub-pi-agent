export type SessionStatus = 'running' | 'needs_input' | 'done' | 'error' | 'interrupted'

export type AgentActivity = {
  phase: 'thinking' | 'replying' | 'calling_tool' | 'tool_running' | 'tool_finished'
  updated_at: number
  tool_name?: string
  is_error?: boolean
}

export type ModelTier = 'fast' | 'balanced' | 'frontier'

export type ModelInfo = {
  readonly key: string       // "provider/id" — pass this as the model param in all tools
  readonly provider: string
  readonly id: string
  readonly tier: ModelTier
}

// Our abstraction over Pi's AgentSession — the only shape the rest of the codebase sees
export type ActiveSession = {
  steer: (text: string) => Promise<void>
  followUp: (text: string) => Promise<void>
  abort: () => Promise<void>
  // Returns an unsubscribe function.
  // onAssistantMessage is optional and receives the full text of the newest assistant message
  // (the current reply), replaced at each new assistant message's first non-empty text delta.
  // Passing it must never change what onDelta/onEnd/onError receive — three-argument callers
  // keep working unchanged.
  subscribe: (
    onDelta: (text: string) => void,
    onEnd: () => void,
    onError: (message: string) => void,
    onAssistantMessage?: (text: string) => void,
    // Compact activity metadata only; never reasoning text, tool arguments or raw results.
    onActivity?: (activity: AgentActivity) => void
  ) => () => void
}

export type SessionEntry = {
  readonly session: ActiveSession
  // Full accumulated delta stream — the complete history. Unchanged semantics.
  readonly output: string
  // Newest assistant reply only, used by poll/get_result. Full output is retained internally.
  readonly latestOutput?: string
  readonly status: SessionStatus
  readonly error?: string
  readonly createdAt: number
  readonly model?: string
}

export type SessionStore = {
  add: (id: string, entry: SessionEntry) => void
  get: (id: string) => SessionEntry | undefined
  update: (id: string, patch: Partial<Pick<SessionEntry, 'output' | 'latestOutput' | 'status' | 'error'>>) => void
  remove: (id: string) => void
  all: () => ReadonlyMap<string, SessionEntry>
  dispose: () => void
}

// What a task-starting tool receives from startSession: the live session plus the model key that
// was actually used for it (explicit, or the Pi default resolved for this task). Non-optional, so
// session records and JSONL logs can never record `undefined` as the model.
export type StartedSession = {
  readonly session: ActiveSession
  readonly modelKey: string
}

// Injectable factory — the only interface tests need to provide a mock for
// modelKey is undefined when the caller wants the Pi default resolved for it.
export type SessionFactory = (
  task: string,
  modelKey: string,
  cwd: string,
  followUp?: boolean
) => Promise<ActiveSession>

export type PiClient = {
  startSession: (task: string, modelKey: string | undefined, cwd: string, followUp?: boolean) => Promise<StartedSession>
  listModels: () => Promise<ModelInfo[]>
}

export type PiError =
  | { kind: 'auth_failed';      message: string }
  | { kind: 'model_not_found';  model: string }
  | { kind: 'session_timeout';  session_id: string; partialOutput: string }
  | { kind: 'pi_unavailable';   message: string }
  | { kind: 'session_not_found'; session_id: string }
  // Raised when a task omits `model` and the Pi default cannot be used. Never softened into a
  // different model: the caller is told why instead of getting a silently different agent.
  | { kind: 'default_model_missing'; message: string }
  | { kind: 'default_model_unavailable'; provider: string; model: string; message: string }
  | { kind: 'settings_unreadable'; message: string }
  | { kind: 'model_registry_unavailable'; message: string }

// Exact overrides for models that don't classify cleanly from their name
const MODEL_TIER_OVERRIDES: Record<string, ModelTier> = {
  'o3':      'frontier',
  'o4':      'frontier',
  'o3-mini': 'balanced',
  'o4-mini': 'balanced',
}

// Keywords matched against the bare model name (provider prefix stripped)
const FAST_PATTERN     = /\b(flash|haiku|mini|nano)\b/i
const FRONTIER_PATTERN = /\b(opus|thinking|pro)\b/i

export const getTier = (modelId: string): ModelTier => {
  if (MODEL_TIER_OVERRIDES[modelId]) return MODEL_TIER_OVERRIDES[modelId]
  // Strip provider prefix: "google/gemini-2.5-pro" → "gemini-2.5-pro"
  const name = modelId.includes('/') ? modelId.split('/').pop()! : modelId
  if (FAST_PATTERN.test(name))     return 'fast'
  if (FRONTIER_PATTERN.test(name)) return 'frontier'
  return 'balanced'
}
