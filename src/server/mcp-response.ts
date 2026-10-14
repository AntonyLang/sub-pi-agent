import type { ManagedAgents } from './managed-agents.js'

export const makeMcpResponse = (agents: ManagedAgents, value: object, isError = false) => {
  const payload = { ...value, ...agents.unreadEvents() }
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }], structuredContent: payload,
    ...(isError ? { isError: true } : {}) }
}
