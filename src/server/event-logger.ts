import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

const DEFAULT_SESSIONS_DIR = join(homedir(), '.claude', 'claude-pi', 'sessions')

export type SessionLogger = {
  delta: (text: string) => Promise<void>
  end:   (output: string) => Promise<void>
  error: (message: string, output: string) => Promise<void>
}

export const makeSessionLogger = (opts: {
  sessionsDir?: string
  sessionId: string
  task: string
  model?: string
}): SessionLogger => {
  const dir = opts.sessionsDir ?? process.env.PI_SESSIONS_DIR ?? DEFAULT_SESSIONS_DIR
  const filePath = join(dir, `${opts.sessionId}.jsonl`)
  const startedAt = Date.now()

  // All writes serialize through this chain — guarantees line order in the JSONL file.
  let writeChain: Promise<void> = mkdir(dir, { recursive: true }).then(() => {})

  const append = (record: Record<string, unknown>): Promise<void> => {
    writeChain = writeChain
      .then(() => appendFile(filePath, JSON.stringify(record) + '\n'))
      .catch(() => {})
    return writeChain
  }

  const base = opts.model !== undefined
    ? { type: 'start', sessionId: opts.sessionId, task: opts.task, model: opts.model, startedAt }
    : { type: 'start', sessionId: opts.sessionId, task: opts.task, startedAt }

  append(base)

  return {
    delta: (text) => append({ type: 'delta', text, ts: Date.now() }),
    end:   (output) => append({ type: 'end', output, durationMs: Date.now() - startedAt, ts: Date.now() }),
    error: (message, output) => append({ type: 'error', message, output, durationMs: Date.now() - startedAt, ts: Date.now() }),
  }
}
