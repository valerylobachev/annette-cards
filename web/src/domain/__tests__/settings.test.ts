import { describe, expect, it } from 'vitest'
import { validateSettingsPatch } from '../settings'

describe('validateSettingsPatch', () => {
  it('rejects values outside the ranges', () => {
    expect(validateSettingsPatch({ desired_retention: 0.99 })).toEqual([
      { field: 'desired_retention', code: 'invalid' },
    ])
    expect(validateSettingsPatch({ day_start_hour: 24 })).toEqual([{ field: 'day_start_hour', code: 'invalid' }])
    expect(validateSettingsPatch({ new_per_day: 0 })).toHaveLength(1)
    expect(validateSettingsPatch({ max_reviews_per_day: 1001 })).toHaveLength(1)
    expect(validateSettingsPatch({ new_per_day: 2.5 })).toHaveLength(1)
  })

  it('accepts the boundaries and fields without ranges', () => {
    expect(
      validateSettingsPatch({
        desired_retention: 0.95,
        day_start_hour: 0,
        new_per_day: 200,
        max_reviews_per_day: 10,
        answer_mode: 'detailed',
      }),
    ).toEqual([])
    expect(validateSettingsPatch({ desired_retention: 0.8, day_start_hour: 23, new_per_day: 1 })).toEqual([])
  })
})
