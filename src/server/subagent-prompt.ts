import type { ToolDefinition } from '@earendil-works/pi-coding-agent'

export const SUBAGENT_SYSTEM_PROMPT = `You are a Pi execution agent delegated by a supervising agent.
Work within the supplied task and report your conclusion concisely when finished.
If missing information or an unresolved decision blocks the task, call ask_supervisor with the specific question, then end this turn. The supervisor will resume this same session with an answer.
Completion and questions are collected through this MCP; do not assume the supervisor receives live notifications.`

export const makeAskSupervisorTool = (onQuestion: (question: string) => void): ToolDefinition => ({
  name: 'ask_supervisor', label: 'Ask supervisor',
  description: 'Hand a blocking question to the supervising agent. After calling this tool, end this turn and wait for the supervisor to resume the same session with an answer.',
  promptSnippet: 'Hand a blocking question to the supervising agent, then end the turn.',
  // Pi validates standard JSON Schema; no extra schema-builder runtime is needed.
  parameters: { type: 'object', properties: { question: { type: 'string', minLength: 1 } },
    required: ['question'], additionalProperties: false } as ToolDefinition['parameters'],
  async execute(_id, params) {
    const { question } = params as { question: string }
    if (!question.trim()) throw new Error('question must contain text')
    onQuestion(question)
    return { content: [{ type: 'text', text: 'Question registered. End this turn; the supervisor will read it and resume this session with an answer.' }], details: {} }
  },
})
