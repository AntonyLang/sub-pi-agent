import { type ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { ActiveSession } from './types.js';
export type ManagedHandle = {
    session: ActiveSession;
    sessionFile: string;
    modelKey: string;
    start: (task: string) => Promise<void>;
    dispose: () => void;
};
export type ManagedFactory = (options: {
    cwd: string;
    sessionDir: string;
    sessionFile?: string;
    model?: string;
    onQuestion: (question: string) => void;
}) => Promise<ManagedHandle>;
export declare const makeManagedSessionFactory: (runtime: ModelRuntime) => ManagedFactory;
