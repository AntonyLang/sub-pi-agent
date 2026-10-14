import { defineConfig } from 'vitest/config'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    // pi_spawn_agent builds a real session logger, and most makeTools() call sites in
    // tools.test.ts don't inject sessionsDir — without this the suite writes a JSONL file
    // into the user's real ~/.claude/claude-pi/sessions on every run.
    env: { PI_SESSIONS_DIR: join(tmpdir(), 'claude-pi-test-sessions') },
  },
})
