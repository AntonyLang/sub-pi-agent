import type { AgentActivity } from './types.js';
export type AgentStatus = 'active' | 'needs_input' | 'done' | 'error' | 'interrupted';
export type AgentRecord = {
    version: 1;
    owner: 'agent-pi';
    session_id: string;
    name: string;
    description: string;
    cwd: string;
    status: AgentStatus;
    createdAt: number;
    lastActivityAt: number;
    generation: number;
    output: string;
    model?: string;
    sessionFile?: string;
    error?: string;
    question?: {
        id: string;
        text: string;
    };
    activity?: AgentActivity;
};
export declare const agentError: (kind: string, message: string) => Error;
/** Only this private registry is discoverable. No Pi CLI session discovery or arbitrary paths. */
export declare class AgentRepository {
    readonly root: string;
    constructor(root: string);
    directory(id: string, create?: boolean): string;
    create(record: AgentRecord): void;
    read(id: string): AgentRecord;
    list(): AgentRecord[];
    save(record: AgentRecord): void;
    eventRead(record: AgentRecord, status: AgentStatus): boolean;
    markEventRead(record: AgentRecord, status: AgentStatus): void;
    private leaseFile;
    private readLease;
    isLoaded(id: string): boolean;
    acquire(id: string): () => void;
    sessionDirectory(id: string): string;
    sessionPath(record: AgentRecord): string | undefined;
    registerSession(record: AgentRecord, path: string): void;
}
