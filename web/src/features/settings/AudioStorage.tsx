import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmSheet } from '@/components/ConfirmSheet'
import { useSnackbar } from '@/components/Snackbar'
import { Button } from '@/components/ui/button'
import { cachedAudioInfo, clearAudioCache } from '@/lib/audio/audioCache'
import { formatBytes, formatNumber } from '@/lib/intl'
import { SettingsRow } from './SettingsList'

const AUDIO_INFO_KEY = ['audio-cache-info'] as const
const STORAGE_KEY = ['storage-estimate'] as const

function useAudioInfo() {
  return useQuery({ queryKey: AUDIO_INFO_KEY, queryFn: cachedAudioInfo })
}

/** S-14 Data: storage used on this device, saved audio clips and "Clear cached audio" (UC-18). */
export function AudioStorageRows() {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const snackbar = useSnackbar()
  const [confirm, setConfirm] = useState(false)
  const audio = useAudioInfo()
  const storage = useQuery({
    queryKey: STORAGE_KEY,
    queryFn: async () => (navigator.storage?.estimate ? await navigator.storage.estimate() : null),
  })
  const estimate = storage.data
  const usage =
    estimate?.usage !== undefined && estimate.quota !== undefined
      ? t('storage.usageValue', {
          used: formatBytes(estimate.usage, i18n.language),
          quota: formatBytes(estimate.quota, i18n.language),
        })
      : t('storage.unknown')
  const count = audio.data?.count ?? 0

  async function clear() {
    await clearAudioCache()
    await queryClient.invalidateQueries({ queryKey: AUDIO_INFO_KEY })
    await queryClient.invalidateQueries({ queryKey: STORAGE_KEY })
    snackbar.show({ message: t('storage.audioCleared') })
  }

  return (
    <>
      <SettingsRow label={t('storage.usage')}>
        <span className="text-right text-muted-foreground tabular-nums">{usage}</span>
      </SettingsRow>
      <div className="flex flex-col gap-2 p-4">
        <p className="text-sm text-muted-foreground" data-testid="cached-audio">
          {t('storage.cachedAudio', { count, formatted: formatNumber(count, i18n.language) })}
        </p>
        <Button
          size="xl"
          variant="outline"
          className="justify-start"
          disabled={count === 0}
          onClick={() => setConfirm(true)}
        >
          <Trash2 className="size-4" aria-hidden />
          {t('storage.clearAudio')}
        </Button>
      </div>
      <ConfirmSheet
        open={confirm}
        onOpenChange={setConfirm}
        title={t('storage.clearAudioConfirm')}
        description={t('storage.clearAudioHint')}
        confirmLabel={t('storage.clearAudio')}
        onConfirm={clear}
      />
    </>
  )
}

/** S-14 About: authors and licenses of the Wikimedia recordings saved on this device. */
export function RecordingAttributions() {
  const { t } = useTranslation()
  const attributions = useAudioInfo().data?.attributions ?? []
  return (
    <details className="px-4 py-3">
      <summary className="min-h-8 cursor-pointer">{t('settings.attributions')}</summary>
      {attributions.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{t('settings.noAttributions')}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1 text-sm break-words text-muted-foreground">
          {attributions.map((attribution) => (
            <li key={attribution}>{attribution}</li>
          ))}
        </ul>
      )}
    </details>
  )
}
