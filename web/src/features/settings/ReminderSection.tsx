import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSettings } from '@/db/hooks'
import { useAccount } from '@/features/auth/account'
import { ApiError } from '@/lib/api'
import { errorMessageKey } from '@/lib/apiErrors'
import { isStandalone } from '@/lib/platform'
import { useServerFeatures } from '@/lib/serverFeatures'
import { useOnline } from '@/lib/useOnline'
import { changeReminderTime, currentSubscription, disableReminders, enableReminders, pushSupported } from './reminders'
import { SettingsGroup, SettingsRow } from './SettingsList'

/**
 * S-14 Reminders (UC-23): a daily reminder at a chosen time. Hidden when the server has no push; turning it on needs
 * the installed app (Web Push on iOS works only from the Home Screen), an account and a connection.
 */
export function ReminderSection() {
  const { t } = useTranslation()
  const features = useServerFeatures()
  const account = useAccount()
  const { reminder } = useSettings()
  const online = useOnline()
  /** Whether this device has a push subscription; `null` while checking. */
  const [subscribed, setSubscribed] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void currentSubscription().then((subscription) => setSubscribed(subscription !== null))
  }, [])

  if (!features?.push) return null

  const blocker = !isStandalone()
    ? t('settings.reminders.install')
    : !pushSupported()
      ? t('settings.reminders.unsupported')
      : account?.account === null
        ? t('settings.reminders.signIn')
        : !online
          ? t('offline.availableOnline')
          : null
  const on = reminder.enabled && subscribed === true

  async function toggle(checked: boolean) {
    setError(null)
    setBusy(true)
    try {
      if (checked) {
        const result = await enableReminders(reminder.time)
        if (result === 'enabled') setSubscribed(true)
        else setError(t(result === 'denied' ? 'settings.reminders.denied' : 'settings.reminders.unsupported'))
      } else {
        await disableReminders()
        setSubscribed(false)
      }
    } catch (err) {
      setError(t(errorMessageKey(err instanceof ApiError ? err.code : 'unknown')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsGroup title={t('settings.reminders.title')}>
      <SettingsRow
        label={t('settings.reminders.enable')}
        htmlFor="reminder"
        hint={blocker ?? t('settings.reminders.hint')}
      >
        <input
          id="reminder"
          type="checkbox"
          role="switch"
          aria-checked={on}
          checked={on}
          disabled={blocker !== null || busy || subscribed === null || !account?.account}
          onChange={(event) => void toggle(event.target.checked)}
          className="size-6 shrink-0 accent-primary"
        />
      </SettingsRow>
      {on && (
        <SettingsRow label={t('settings.reminders.time')} htmlFor="reminder-time">
          <input
            id="reminder-time"
            type="time"
            value={reminder.time}
            onChange={(event) => event.target.value && void changeReminderTime(event.target.value)}
            className="h-11 rounded-lg border bg-background px-3 tabular-nums"
          />
        </SettingsRow>
      )}
      {error && (
        <p role="alert" className="px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}
    </SettingsGroup>
  )
}
