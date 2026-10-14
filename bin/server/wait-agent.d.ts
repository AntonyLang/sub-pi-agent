import type { SessionStatus } from './types.js';
export type WaitAgentInput = {
    session_id: string;
    timeout_ms?: number;
};
export declare const waitForAgent: (readStatus: () => SessionStatus, timeoutMs?: number, signal?: AbortSignal) => Promise<{
    status: SessionStatus;
    timed_out: boolean;
    next: string;
}>;
