import { AgentRepository, type AgentStatus } from './agent-repository.js';
import type { ManagedFactory } from './managed-session.js';
import type { SessionStore } from './types.js';
import { type WaitAgentInput } from './wait-agent.js';
export type SpawnAgentInput = {
    task: string;
    model?: string;
    cwd?: string;
    name?: string;
    description?: string;
    followUp?: boolean;
};
export declare class ManagedAgents {
    readonly repository: AgentRepository;
    private readonly factory;
    private readonly store;
    private readonly options;
    private readonly live;
    private readonly observed;
    private readonly mutating;
    private readonly timer;
    private closed;
    constructor(repository: AgentRepository, factory: ManagedFactory, store: SessionStore, options?: {
        idleMs?: number;
        now?: () => number;
        sweepMs?: number;
    });
    private now;
    private view;
    private record;
    private assertTask;
    list({ status, cwd }?: {
        status?: AgentStatus;
        cwd?: string;
    }): {
        agents: {
            session_id: string;
            name: string;
            description: string;
            status: AgentStatus;
            cwd: string;
            model: string | undefined;
            lastActivityAt: number;
            loaded: boolean;
        }[];
    };
    spawn(input: SpawnAgentInput): Promise<{
        session_id: string;
        name: string;
        description: string;
        status: string;
    }>;
    continue({ session_id, task, model }: {
        session_id: string;
        task: string;
        model?: string;
    }): Promise<{
        session_id: string;
        name: string;
        description: string;
        status: string;
    }>;
    private start;
    private persist;
    private schedulePersist;
    private finish;
    poll({ session_id }: {
        session_id: string;
    }): {
        error?: string | undefined;
        question?: {
            id: string;
            text: string;
        } | undefined;
        next?: string | undefined;
        activity?: import("./types.js").AgentActivity | undefined;
        status: string;
        output: string;
    };
    wait({ session_id, timeout_ms }: WaitAgentInput, signal?: AbortSignal): Promise<{
        status: import("./types.js").SessionStatus;
        timed_out: boolean;
        next: string;
    }>;
    result({ session_id }: {
        session_id: string;
    }): Promise<{
        ready: boolean;
        reason: string;
        next: string;
        status?: undefined;
        output?: undefined;
        error?: undefined;
    } | {
        status: "done";
        output: string;
        ready?: undefined;
        reason?: undefined;
        next?: undefined;
        error?: undefined;
    } | {
        status: "error" | "interrupted";
        output: string;
        error: string;
        ready?: undefined;
        reason?: undefined;
        next?: undefined;
    }>;
    unreadEvents(): {};
    steer({ session_id, message }: {
        session_id: string;
        message: string;
    }): Promise<{
        ok: boolean;
        message: string;
        status: string;
        reason: string;
    } | {
        ok: boolean;
        message: string;
        status: string;
        reason?: undefined;
    }>;
    followup({ session_id, message }: {
        session_id: string;
        message: string;
    }): Promise<{
        ok: boolean;
    }>;
    release({ session_id }: {
        session_id: string;
    }): {
        session_id: string;
        released: boolean;
        recoverable: boolean;
    };
    sweep(): void;
    terminate({ session_id }: {
        session_id: string;
    }): Promise<{
        output: string;
        status: AgentStatus;
    }>;
    close(): Promise<void>;
}
