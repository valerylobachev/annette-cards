import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react'
import { useMeta } from '@/db/hooks'
import { DEFAULT_SPEECH_RATE, type SpeechPrefs, speak, speechSupported, systemSpeaker } from './speech'
import { bestVoice, loadVoices, type Voice, voicesFor } from './voices'

type SpeechState = { voices: Voice[] | null; prefs: SpeechPrefs }

const defaults: SpeechState = { voices: null, prefs: { rate: DEFAULT_SPEECH_RATE, voicePref: {} } }
const SpeechContext = createContext<SpeechState>(defaults)

/** Installed voices; `null` while loading. Refreshes on `voiceschanged` and when the app becomes visible again. */
function useInstalledVoices(): Voice[] | null {
  const [voices, setVoices] = useState<Voice[] | null>(null)
  useEffect(() => {
    if (!speechSupported()) {
      setVoices([])
      return
    }
    let active = true
    const refresh = () => {
      if (active) setVoices(speechSynthesis.getVoices())
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    void loadVoices().then((loaded) => active && setVoices(loaded))
    speechSynthesis.addEventListener('voiceschanged', refresh)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      active = false
      speechSynthesis.removeEventListener('voiceschanged', refresh)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
  return voices
}

/** Voices and this device's speech preferences (`meta.voice_pref`, `meta.speech_rate`) for the whole app. */
export function SpeechProvider({ children }: { children: ReactNode }) {
  const voices = useInstalledVoices()
  const voicePref = useMeta('voice_pref')
  const rate = useMeta('speech_rate')
  const value = useMemo(
    () => ({ voices, prefs: { rate: rate ?? DEFAULT_SPEECH_RATE, voicePref: voicePref ?? {} } }),
    [voices, rate, voicePref],
  )
  return <SpeechContext value={value}>{children}</SpeechContext>
}

export function useSpeech() {
  const { voices, prefs } = useContext(SpeechContext)
  return useMemo(
    () => ({
      voices,
      prefs,
      speaker: systemSpeaker(prefs),
      /** Speaks text in a studied language; call it straight from a tap handler. */
      speak: (text: string, lang: string) => speak(text, { lang, rate: prefs.rate, voiceURI: prefs.voicePref[lang] }),
      voicesFor: (lang: string) => voicesFor(voices ?? [], lang),
      /** `null` while the voice list is still loading. */
      hasVoice: (lang: string) => (voices === null ? null : bestVoice(voices, lang) !== null),
    }),
    [voices, prefs],
  )
}
