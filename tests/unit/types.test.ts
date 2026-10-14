import { describe, it, expect } from 'vitest'
import { getTier } from '../../src/server/types.js'

describe('getTier', () => {
  it('classifies flash models as fast', () => {
    expect(getTier('gemini-2.0-flash')).toBe('fast')
    expect(getTier('gemini-2.5-flash')).toBe('fast')
    expect(getTier('gemini-3-flash-preview')).toBe('fast')
    expect(getTier('ling-2.6-flash-free')).toBe('fast')
  })

  it('classifies haiku models as fast', () => {
    expect(getTier('claude-haiku-4-5')).toBe('fast')
    expect(getTier('claude-haiku-4.5')).toBe('fast')
  })

  it('classifies mini models as fast', () => {
    expect(getTier('gpt-4o-mini')).toBe('fast')
  })

  it('classifies opus models as frontier', () => {
    expect(getTier('claude-opus-4-7')).toBe('frontier')
    expect(getTier('claude-opus-4.5')).toBe('frontier')
  })

  it('classifies pro models as frontier', () => {
    expect(getTier('gemini-2.5-pro')).toBe('frontier')
  })

  it('classifies thinking models as frontier', () => {
    expect(getTier('moonshotai/Kimi-K2-Thinking')).toBe('frontier')
  })

  it('strips provider prefix before classifying', () => {
    expect(getTier('XiaomiMiMo/MiMo-V2-Flash')).toBe('fast')
    expect(getTier('google/gemini-2.5-pro')).toBe('frontier')
    expect(getTier('anthropic/claude-haiku-4.5')).toBe('fast')
  })

  it('does not misclassify minimax as fast', () => {
    expect(getTier('minimax-m2.5-free')).toBe('balanced')
  })

  it('exact overrides: o3/o4 are frontier, o3-mini/o4-mini are balanced', () => {
    expect(getTier('o3')).toBe('frontier')
    expect(getTier('o4')).toBe('frontier')
    expect(getTier('o3-mini')).toBe('balanced')
    expect(getTier('o4-mini')).toBe('balanced')
  })

  it('falls back to balanced for unknown models', () => {
    expect(getTier('totally-unknown-model')).toBe('balanced')
    expect(getTier('big-pickle')).toBe('balanced')
    expect(getTier('deepseek-ai/DeepSeek-V3.2')).toBe('balanced')
  })
})
