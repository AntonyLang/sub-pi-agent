import { type PiSettings } from './pi-settings.js';
import type { PiError } from './types.js';
/**
 * Reads the effective Pi settings for a working directory. The production implementation lives in
 * pi-client.ts (it uses the Pi SDK's SettingsManager so global/project precedence is native);
 * declared here so the resolver and the client share one seam and tests inject a plain function.
 */
export type SettingsReader = (scope: {
    cwd: string;
}) => Promise<PiSettings>;
export type ModelResolverRuntime = {
    /** Reload the local model catalog. Network access must stay off. */
    refresh?: (options: {
        allowNetwork: boolean;
    }) => Promise<unknown>;
    getModel: (provider: string, id: string) => unknown;
};
export type ResolveModelResult = {
    ok: true;
    modelKey: string;
} | {
    ok: false;
    error: PiError;
};
/**
 * Resolve the model key for a brand-new task when the caller passed no explicit model.
 *
 * Settings are read *per call*, so a task started after the user edits their Pi settings picks up
 * the new default without restarting this MCP server. There is deliberately **no fallback**: a
 * missing or unusable default is reported as a typed error rather than silently downgraded to
 * whatever model happens to be listed first.
 *
 * A default model id may itself contain slashes (`cpa` + `deepseek/deepseek-v4.1-flash`), so the
 * key is assembled as `${provider}/${defaultModel}` and never re-split or truncated.
 */
export declare const resolveModelKey: (runtime: ModelResolverRuntime, opts: {
    cwd: string;
    readSettings?: SettingsReader;
}) => Promise<ResolveModelResult>;
