import { ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent';
import type { ActiveSession, ModelInfo, PiClient, SessionFactory } from './types.js';
import { type ModelResolverRuntime, type SettingsReader } from './model-resolution.js';
type ModelRuntimeLike = ModelResolverRuntime & {
    getAvailable: () => ReadonlyArray<{
        provider: string;
        id: string;
    }> | PromiseLike<ReadonlyArray<{
        provider: string;
        id: string;
    }>>;
};
/**
 * Pi-native settings reader, deliberately built the same way the SDK's own session bootstrap builds
 * one (`SettingsManager.create(cwd, agentDir)`, default `projectTrusted: true`): the SDK merges
 * `~/.pi/agent/settings.json` with `<cwd>/.pi/settings.json`, project layer winning, so a project
 * default overrides the global one exactly as it does for a Pi agent started from this cwd. No
 * extra trust policy is layered on here — inventing one would silently drop a project default that
 * Pi itself honours.
 *
 * The SDK swallows settings read failures (a malformed file yields empty settings), so
 * `drainErrors()` is checked before the values are used: a task is never launched on a silently
 * degraded read. Read-only: SettingsManager.create() loads settings and never writes them.
 */
export declare const readEffectivePiSettings: SettingsReader;
type PiSessionLike = {
    steer: (text: string) => Promise<unknown>;
    followUp?: (text: string) => Promise<unknown>;
    abort: () => Promise<void>;
    subscribe: (listener: (event: unknown) => void) => () => void;
};
export declare const makePiSessionAdapter: (piSession: PiSessionLike, opts?: {
    followUp?: boolean;
}) => ActiveSession;
export declare const makePiSessionFactory: (deps: {
    modelRuntime: ModelRuntime;
    createSessionManager?: (cwd: string) => SessionManager;
}) => SessionFactory;
export declare const makePiClient: (factory: SessionFactory, modelRuntime: ModelRuntimeLike, opts?: {
    readSettings?: SettingsReader;
}) => PiClient;
export declare const listPiModels: (modelRuntime: ModelRuntimeLike, opts?: {
    readSettings?: SettingsReader;
}) => Promise<ModelInfo[]>;
export {};
