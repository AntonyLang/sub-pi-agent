import { SessionManager, SettingsManager, createAgentSession, getAgentDir, } from '@earendil-works/pi-coding-agent';
import { getTier } from './types.js';
import { filterByEnabledModels } from './pi-settings.js';
import { resolveModelKey } from './model-resolution.js';
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
export const readEffectivePiSettings = async ({ cwd }) => {
    const manager = SettingsManager.create(cwd, getAgentDir());
    const errors = manager.drainErrors();
    if (errors.length > 0) {
        const [first] = errors;
        const where = first.path ? ` (${first.path})` : '';
        throw new Error(`Could not read ${first.scope} Pi settings${where}: ${first.error.message}`);
    }
    return manager.getSettings();
};
// Exported for unit testing — adapts any PiSession-like object to ActiveSession.
// Subscribes immediately on construction to buffer events, then drains the buffer
// when the caller's subscribe() arrives (prevents race with fast completions).
export const makePiSessionAdapter = (piSession, opts = {}) => {
    const buffered = [];
    let forward = null;
    piSession.subscribe((event) => {
        if (forward) {
            forward(event);
        }
        else {
            buffered.push(event);
        }
    });
    return {
        steer: async (text) => { await piSession.steer(text); },
        followUp: async (text) => {
            if (piSession.followUp)
                await piSession.followUp(text);
            else
                await piSession.steer(text);
        },
        abort: () => piSession.abort(),
        subscribe: (onDelta, onEnd, onError, onAssistantMessage, onActivity) => {
            // Tracks error from message_end so agent_end can route to onError instead of onEnd.
            // Pi SDK fires message_end { stopReason: 'error' } before agent_end on provider failures.
            let pendingError = null;
            let activity;
            const reportActivity = (phase, toolName, isError) => {
                if (activity?.phase === phase && activity.tool_name === toolName && activity.is_error === isError)
                    return;
                activity = { phase, updated_at: Date.now(), ...(toolName ? { tool_name: toolName } : {}),
                    ...(isError !== undefined ? { is_error: isError } : {}) };
                onActivity?.(activity);
            };
            // Newest-assistant-reply tracking. Segmentation follows the real Pi SDK message boundaries —
            // `message_start` with role 'assistant' opens a reply, `message_end` closes it — never
            // text_delta/blank-line/paragraph heuristics. Multiple text blocks inside one assistant
            // message belong to the same reply and are concatenated in stream order. Nothing is cleared
            // on message_start: a turn that only thinks or calls tools leaves the previous reply intact,
            // and the reply is only replaced once the new assistant message emits its first non-empty
            // text delta.
            let inAssistantMessage = false;
            let reply = '';
            let replyHasText = false;
            forward = (event) => {
                const e = event;
                if (e['type'] === 'message_start') {
                    const msg = e['message'];
                    if (msg?.['role'] === 'assistant') {
                        inAssistantMessage = true;
                        reply = '';
                        replyHasText = false;
                    }
                }
                else if (e['type'] === 'message_update') {
                    // Pi SDK normalizes all providers to AssistantMessageEvent.
                    // text_delta events carry delta: string directly (not Anthropic's raw format).
                    const ame = e['assistantMessageEvent'];
                    if (ame?.['type'] === 'thinking_start' || ame?.['type'] === 'thinking_delta')
                        reportActivity('thinking');
                    else if (ame?.['type'] === 'toolcall_start' || ame?.['type'] === 'toolcall_delta')
                        reportActivity('calling_tool');
                    if (ame?.['type'] === 'text_delta') {
                        const delta = String(ame['delta'] ?? '');
                        if (delta !== '')
                            reportActivity('replying');
                        onDelta(delta);
                        if (delta !== '') {
                            // A message_update can only belong to the assistant message opened by message_start;
                            // treat a missing start as an implicit one rather than dropping real text.
                            if (!inAssistantMessage) {
                                inAssistantMessage = true;
                                reply = '';
                                replyHasText = false;
                            }
                            if (replyHasText)
                                reply += delta;
                            else {
                                reply = delta;
                                replyHasText = true;
                            }
                            onAssistantMessage?.(reply);
                        }
                    }
                }
                else if (e['type'] === 'tool_execution_start') {
                    reportActivity('tool_running', String(e['toolName'] ?? 'tool'));
                }
                else if (e['type'] === 'tool_execution_end') {
                    reportActivity('tool_finished', String(e['toolName'] ?? 'tool'), e['isError'] === true);
                }
                else if (e['type'] === 'message_end') {
                    // Pi SDK nests stopReason/errorMessage inside e['message'], not at top level
                    const msg = e['message'];
                    if (msg?.['stopReason'] === 'error') {
                        pendingError = String(msg['errorMessage'] ?? 'Pi agent error');
                    }
                    // Only an assistant message_end closes the reply boundary. A user/toolResult message_end
                    // (which the SDK emits with an explicit role) must NOT end an in-flight assistant reply —
                    // the same assistant message can still stream more text after it. A role-less legacy event
                    // is treated as the assistant's own end while a reply is open.
                    const role = msg?.['role'];
                    if (role === 'assistant' || (role === undefined && inAssistantMessage)) {
                        inAssistantMessage = false;
                        reply = '';
                        replyHasText = false;
                    }
                }
                else if (e['type'] === 'agent_end') {
                    if (pendingError) {
                        onError(pendingError);
                    }
                    else {
                        onEnd();
                    }
                }
            };
            for (const e of buffered)
                forward(e);
            buffered.length = 0;
            return () => { forward = null; };
        },
    };
};
// Production session factory. Requires Pi auth to be configured via `pi auth` or
// provider env vars (ANTHROPIC_API_KEY, GEMINI_API_KEY, etc.) before calling.
export const makePiSessionFactory = (deps) => async (task, modelKey, cwd, followUp) => {
    const [provider, ...idParts] = modelKey.split('/');
    const id = idParts.join('/');
    // getModel is the 0.84 replacement for ModelRegistry.find — still sync, still
    // returns undefined (not a throw) when the provider/id pair is unknown.
    const model = deps.modelRuntime.getModel(provider, id);
    if (!model)
        throw { kind: 'model_not_found', model: modelKey };
    const { session } = await createAgentSession({
        model,
        cwd,
        modelRuntime: deps.modelRuntime,
        sessionManager: deps.createSessionManager?.(cwd) ?? SessionManager.inMemory(cwd),
    });
    // Adapter subscribes immediately and buffers events, so fire prompt as a
    // background task — tools.ts gets the session handle while the agent runs,
    // allowing store.add('running') to fire before the task completes.
    const adapted = makePiSessionAdapter(session);
    if (followUp) {
        session.followUp(task).catch(() => { });
    }
    else {
        session.prompt(task).catch(() => { });
    }
    return adapted;
};
export const makePiClient = (factory, modelRuntime, opts = {}) => ({
    startSession: async (task, modelKey, cwd, followUp) => {
        // An explicit model always wins and short-circuits the settings read entirely — a task that
        // names its model must not fail because the user has no default configured.
        // Otherwise the default is re-read for every new task, so a settings edit applies to the next
        // task without restarting the server. A task already running keeps the key it started with.
        // typeof guards against a non-string argument reaching a non-validating MCP caller.
        const explicit = typeof modelKey === 'string' && modelKey.trim() !== '' ? modelKey.trim() : undefined;
        let resolvedKey = explicit;
        if (!resolvedKey) {
            const resolved = await resolveModelKey(modelRuntime, {
                cwd,
                readSettings: opts.readSettings ?? readEffectivePiSettings,
            });
            if (!resolved.ok)
                throw resolved.error;
            resolvedKey = resolved.modelKey;
        }
        const session = await factory(task, resolvedKey, cwd, followUp);
        // Both halves are returned explicitly — callers log the resolved key, never the (possibly
        // absent) argument, so a session record always names the model that ran.
        return { session, modelKey: resolvedKey };
    },
    listModels: () => listPiModels(modelRuntime, opts),
});
export const listPiModels = async (modelRuntime, opts = {}) => {
    // Reload models.json when requested, without fetching remote model catalogs.
    await modelRuntime.refresh?.({ allowNetwork: false });
    const getSettings = opts.readSettings ?? readEffectivePiSettings;
    // listModels has no task cwd yet; Claude's own cwd is the best available scope.
    const [models, settings] = await Promise.all([
        modelRuntime.getAvailable(),
        getSettings({ cwd: process.cwd() }).catch(() => ({})),
    ]);
    return filterByEnabledModels(models, settings).map((m) => ({
        key: `${m.provider}/${m.id}`,
        provider: m.provider,
        id: m.id,
        tier: getTier(m.id),
    }));
};
