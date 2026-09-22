import { describe, expect, it } from 'vitest'
import en from '@/i18n/en.json'
import ru from '@/i18n/ru.json'
import { parseReminderPayload, reminderNotification } from '../reminder'

describe('reminderNotification', () => {
  it('uses the Russian plural forms', () => {
    const body = (due: number) => reminderNotification(due, 'ru', ru.notifications.reminder).body
    expect(body(1)).toBe('1 слово на повторение')
    expect(body(2)).toBe('2 слова на повторение')
    expect(body(5)).toBe('5 слов на повторение')
    expect(body(21)).toBe('21 слово на повторение')
    expect(body(1000)).toBe('1 000 слов на повторение')
  })

  it('uses the English plural forms', () => {
    expect(reminderNotification(1, 'en', en.notifications.reminder)).toEqual({
      title: 'Time to review',
      body: '1 word to review',
    })
    expect(reminderNotification(18, 'en', en.notifications.reminder).body).toBe('18 words to review')
  })
})

describe('parseReminderPayload', () => {
  it('accepts only reminder payloads with a count', () => {
    expect(parseReminderPayload({ type: 'reminder', due: 3 })).toEqual({ type: 'reminder', due: 3 })
    expect(parseReminderPayload({ type: 'reminder', due: -1 })).toBeNull()
    expect(parseReminderPayload({ type: 'other', due: 3 })).toBeNull()
    expect(parseReminderPayload('reminder')).toBeNull()
    expect(parseReminderPayload(null)).toBeNull()
  })
})
