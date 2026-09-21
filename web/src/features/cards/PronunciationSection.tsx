import { useQuery } from '@tanstack/react-query'
import { AudioLines, Mic, Trash2 } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { attachAudio, removeAudio } from '@/api/endpoints/audio/audio'
import { OfflineHint } from '@/components/OfflineHint'
import { Button } from '@/components/ui/button'
import { applyServerAudio } from '@/db/cards'
import { db } from '@/db/schema'
import type { Card, Deck } from '@/domain/types'
import { markSessionExpired, useAccount } from '@/features/auth/account'
import { syncNow } from '@/features/sync/engine'
import { apiErrorCode, callApi, isUnauthorized } from '@/lib/api'
import { errorMessageKey } from '@/lib/apiErrors'
import { type AudioDetails, audioDetails, cachedOrDownloaded, download } from '@/lib/audio/audioCache'
import { unlockAudio } from '@/lib/audio/playCard'
import { useServerFeatures } from '@/lib/serverFeatures'
import { useSpeech } from '@/lib/speech/useSpeech'

type Action = 'tts' | 'commons' | 'remove'

/**
 * S-07 Pronunciation: where the word's audio comes from (system voice, generated, a recording with its attribution)
 * and, for a signed-in user, generating, finding and removing server audio (UC-13). The server edits the card;
 * its new `audio_id` is written locally without an outbox entry and arrives with its stamp on the next pull.
 */
export function PronunciationSection({ card, deck }: { card: Card; deck: Deck }) {
  const { t } = useTranslation()
  const features = useServerFeatures()
  const account = useAccount()
  const signedIn = !!account?.account && !account.sessionExpired
  const { pronounce } = useSpeech()
  const [busy, setBusy] = useState<Action | null>(null)
  const [error, setError] = useState<string | null>(null)
  const details = useQuery({
    queryKey: ['audio-details', card.audio_id],
    queryFn: async (): Promise<AudioDetails | null> => {
      const response = card.audio_id ? await cachedOrDownloaded(card.audio_id) : undefined
      return response ? audioDetails(response) : null
    },
    enabled: card.audio_id !== null,
    staleTime: Number.POSITIVE_INFINITY,
  })

  async function run(action: Action) {
    // Synchronously in the tap, so the new clip may play when the server answers (iOS).
    unlockAudio()
    setBusy(action)
    setError(null)
    try {
      // The server edits the card; unsynced local edits of it are pushed first so they are not overwritten.
      if ((await db.outbox.where('[entity+entity_id]').equals(['cards', card.id]).count()) > 0) {
        await syncNow('manual')
      }
      if (action === 'remove') {
        await callApi(() => removeAudio(card.id))
        await applyServerAudio(card.id, null)
      } else {
        const answer = await callApi(() => attachAudio(card.id, { source: action }))
        await applyServerAudio(card.id, answer.audio_id)
        await download(answer.audio_id)
        void pronounce(card.front, deck.target_lang, answer.audio_id)
      }
      void syncNow('manual')
    } catch (failure) {
      if (isUnauthorized(failure)) await markSessionExpired()
      const code = apiErrorCode(failure)
      setError(action === 'commons' && code === 'not_found' ? t('pronunciation.noRecording') : t(errorMessageKey(code)))
    } finally {
      setBusy(null)
    }
  }

  const canGenerate = signedIn && features?.tts === true
  const canFind = signedIn && features?.commons === true
  const canRemove = signedIn && card.audio_id !== null
  const hasActions = canGenerate || canFind || canRemove

  return (
    <section className="flex flex-col gap-2" aria-labelledby="pronunciation-title">
      <h2 id="pronunciation-title" className="text-sm font-medium text-muted-foreground">
        {t('pronunciation.title')}
      </h2>
      <p data-testid="audio-source">{sourceLabel(t, card, details.data)}</p>
      {details.data?.attribution && (
        <p className="text-sm break-words text-muted-foreground">
          {t('pronunciation.attribution', { attribution: details.data.attribution })}
        </p>
      )}
      {hasActions && (
        <OfflineHint>
          {(offline) => (
            <div className="flex flex-wrap gap-2">
              {canGenerate && (
                <ActionButton busy={busy} action="tts" disabled={offline} onRun={run}>
                  <AudioLines className="size-4" aria-hidden />
                  {t('pronunciation.generate')}
                </ActionButton>
              )}
              {canFind && (
                <ActionButton busy={busy} action="commons" disabled={offline} onRun={run}>
                  <Mic className="size-4" aria-hidden />
                  {t('pronunciation.findRecording')}
                </ActionButton>
              )}
              {canRemove && (
                <ActionButton busy={busy} action="remove" disabled={offline} onRun={run}>
                  <Trash2 className="size-4" aria-hidden />
                  {t('pronunciation.remove')}
                </ActionButton>
              )}
            </div>
          )}
        </OfflineHint>
      )}
      {busy && (
        <p role="status" className="text-sm text-muted-foreground">
          {t(busy === 'remove' ? 'pronunciation.removing' : 'pronunciation.working')}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}

type ActionButtonProps = {
  action: Action
  busy: Action | null
  disabled: boolean
  onRun: (action: Action) => void
  children: ReactNode
}

function ActionButton({ action, busy, disabled, onRun, children }: ActionButtonProps) {
  return (
    <Button
      size="xl"
      variant={action === 'remove' ? 'ghost' : 'secondary'}
      disabled={disabled || busy !== null}
      onClick={() => onRun(action)}
    >
      {children}
    </Button>
  )
}

function sourceLabel(
  t: ReturnType<typeof useTranslation>['t'],
  card: Card,
  details: AudioDetails | null | undefined,
): string {
  if (card.audio_id === null) return t('pronunciation.systemVoice')
  if (details?.source === 'azure') return t('pronunciation.generated')
  if (details?.source === 'commons') return t('pronunciation.recording')
  // Not cached and offline: the clip exists, its kind is known once it is downloaded.
  return t('pronunciation.serverAudio')
}
