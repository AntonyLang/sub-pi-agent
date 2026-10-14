export type SessionStatus = 'running' | 'needs_input' | 'done' | 'error' | 'interrupted';
export type AgentActivity = {
    phase: 'thinking' | 'replying' | 'calling_tool' | 'tool_running' | 'tool_finished';
    updated_at: number;
    tool_name?: string;
    is_error?: boolean;
};
export type ModelTier = 'fast' | 'balanced' | 'frontier';
export type ModelInfo = {
    readonly key: string;
    readonly provider: string;
    readonly id: string;
    readonly tier: ModelTier;
};
export type ActiveSession = {
    steer: (text: string) => Promise<void>;
    followUp: (text: string) => Promise<void>;
    abort: () => Promise<void>;
    subscribe: (onDelta: (text: string) => void, onEnd: () => void, onError: (message: string) => void, onAssistantMessage?: (text: string) => void, onActivity?: (activity: AgentActivity) => void) => () => void;
};
export type SessionEntry = {
    readonly session: ActiveSession;
    readonly output: string;
    readonly latestOutput?: string;
    readonly status: SessionStatus;
    readonly error?: string;
    readonly createdAt: number;
    readonly model?: string;
};
export type SessionStore = {
    add: (id: string, entry: SessionEntry) => void;
    get: (id: string) => SessionEntry | undefined;
    update: (id: string, patch: Partial<Pick<SessionEntry, 'output' | 'latestOutput' | 'status' | 'error'>>) => void;
    remove: (id: string) => void;
    all: () => ReadonlyMap<string, SessionEntry>;
    dispose: () => void;
};
export type StartedSession = {
    readonly session: ActiveSession;
    readonly modelKey: string;
};
export type SessionFactory = (task: string, modelKey: string, cwd: string, followUp?: boolean) => Promise<ActiveSession>;
export type PiClient = {
    startSession: (task: string, modelKey: string | undefined, cwd: string, followUp?: boolean) => Promise<StartedSession>;
    listModels: () => Promise<ModelInfo[]>;
};
export type PiError = {
    kind: 'auth_failed';
    message: string;
} | {
    kind: 'model_not_found';
    model: string;
} | {
    kind: 'session_timeout';
    session_id: string;
    partialOutput: string;
} | {
    kind: 'pi_unavailable';
    message: string;
} | {
    kind: 'session_not_found';
    session_id: string;
} | {
    kind: 'default_model_missing';
    message: string;
} | {
    kind: 'default_model_unavailable';
    provider: string;
    model: string;
    message: string;
} | {
    kind: 'settings_unreadable';
    message: string;
} | {
    kind: 'model_registry_unavailable';
    message: string;
};
export declare const getTier: (modelId: string) => ModelTier;
