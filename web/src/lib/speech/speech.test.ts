import { describe, expect, it } from 'vitest'
import type { Autoplay, Direction } from '@/domain/types'
import { shouldSpeak } from './speech'

describe('shouldSpeak', () => {
  const table: [Autoplay, Direction, 'front' | 'back', boolean][] = [
    ['off', 'forward', 'front', false],
    ['off', 'reverse', 'back', false],
    ['front', 'forward', 'front', true],
    ['front', 'forward', 'back', false],
    ['front', 'reverse', 'front', false],
    ['front', 'reverse', 'back', false],
    ['front_and_back', 'forward', 'front', true],
    ['front_and_back', 'forward', 'back', false],
    ['front_and_back', 'reverse', 'front', false],
    ['front_and_back', 'reverse', 'back', true],
  ]
  it.each(table)('autoplay %s, %s, %s side → %s', (autoplay, direction, side, expected) => {
    expect(shouldSpeak(autoplay, direction, side)).toBe(expected)
  })
})
