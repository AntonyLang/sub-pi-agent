import { readPiSettings } from './pi-settings.js';
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
export const resolveModelKey = async (runtime, opts) => {
    // Production always injects the SDK-backed reader; the global-file reader is the conservative
    // default for a resolver built without one (same precedence as the session-start monitor).
    const readSettings = opts.readSettings ?? (() => readPiSettings());
    let settings;
    try {
        settings = await readSettings({ cwd: opts.cwd });
    }
    catch (err) {
        return {
            ok: false,
            error: {
                kind: 'settings_unreadable',
                message: err instanceof Error ? err.message : String(err),
            },
        };
    }
    const provider = settings.defaultProvider;
    const modelId = settings.defaultModel;
    if (!provider || !modelId) {
        return {
            ok: false,
            error: {
                kind: 'default_model_missing',
                message: 'No default Pi model is configured (settings.defaultProvider/defaultModel). Pass an explicit model.',
            },
        };
    }
    // Reload the local model catalog before consulting it, without network access, so the registry
    // reflects models.json as it is now rather than as it was when this server started. A failed
    // reload is reported: continuing against a stale registry would silently ignore the user's
    // current configuration, which is exactly what resolving the default per task exists to avoid.
    if (runtime.refresh) {
        try {
            await runtime.refresh({ allowNetwork: false });
        }
        catch (err) {
            return {
                ok: false,
                error: {
                    kind: 'model_registry_unavailable',
                    message: `Could not reload the Pi model registry: ${err instanceof Error ? err.message : String(err)}`,
                },
            };
        }
    }
    const found = runtime.getModel(provider, modelId);
    if (found === undefined || found === null) {
        return {
            ok: false,
            error: {
                kind: 'default_model_unavailable',
                provider,
                model: modelId,
                message: `Default Pi model ${provider}/${modelId} is not in the model registry. Pass an explicit model.`,
            },
        };
    }
    return { ok: true, modelKey: `${provider}/${modelId}` };
};
