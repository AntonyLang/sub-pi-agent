import { createAgentSession, DefaultResourceLoader, getAgentDir, SessionManager, SettingsManager, type ModelRuntime } from '@earendil-works/pi-coding-agent'
import { makePiSessionAdapter, readEffectivePiSettings } from './pi-client.js'
import { resolveModelKey } from './model-resolution.js'
import type { ActiveSession } from './types.js'
import { makeAskSupervisorTool, SUBAGENT_SYSTEM_PROMPT } from './subagent-prompt.js'

export type ManagedHandle = {
  session: ActiveSession; sessionFile: string; modelKey: string
  start: (task: string) => Promise<void>; dispose: () => void
}
export type ManagedFactory = (options: { cwd: string; sessionDir: string; sessionFile?: string; model?: string;
  onQuestion: (question: string) => void }) => Promise<ManagedHandle>

export const makeManagedSessionFactory = (runtime: ModelRuntime): ManagedFactory => async (options) => {
  let key = options.model?.trim()
  if (!key) {
    const result = await resolveModelKey(runtime, { cwd: options.cwd, readSettings: readEffectivePiSettings })
    if (!result.ok) throw result.error
    key = result.modelKey
  } else { await runtime.refresh({ allowNetwork: false }) }
  const [provider, ...parts] = key.split('/')
  const model = runtime.getModel(provider, parts.join('/'))
  if (!model) throw new Error(`model_not_found: ${key}`)
  const settings = SettingsManager.create(options.cwd, getAgentDir())
  const errors = settings.drainErrors()
  if (errors.length) throw new Error(`settings_unreadable: ${errors[0].error.message}`)
  const manager = options.sessionFile
    ? SessionManager.open(options.sessionFile, options.sessionDir, options.cwd)
    : SessionManager.create(options.cwd, options.sessionDir)
  const resourceLoader = new DefaultResourceLoader({ cwd: options.cwd, agentDir: getAgentDir(), settingsManager: settings,
    appendSystemPromptOverride: base => [...base, SUBAGENT_SYSTEM_PROMPT] })
  await resourceLoader.reload()
  const { session } = await createAgentSession({
    cwd: options.cwd, model, modelRuntime: runtime, sessionManager: manager, settingsManager: settings,
    resourceLoader, customTools: [makeAskSupervisorTool(options.onQuestion)],
    // A restored session would otherwise prefer its old thinking setting to today's Pi settings.
    thinkingLevel: settings.getModelThinkingLevel(provider, model.id) ?? settings.getDefaultThinkingLevel() ?? 'medium',
  })
  const file = manager.getSessionFile()
  if (!file) { session.dispose(); throw new Error('Pi did not allocate a persistent session') }
  return {
    session: makePiSessionAdapter(session), sessionFile: file, modelKey: key,
    start: (task) => session.prompt(task), dispose: () => session.dispose(),
  }
}
