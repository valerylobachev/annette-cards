/** The fields of `SpeechSynthesisVoice` the app uses (a plain object in tests). */
export type Voice = Pick<SpeechSynthesisVoice, 'voiceURI' | 'name' | 'lang' | 'default' | 'localService'>

export type VoiceQuality = 'premium' | 'enhanced' | 'default'

/**
 * Quality from the voice name or URI: iOS and macOS name downloaded voices "… (Premium)" / "… (Enhanced)" and use
 * URIs like `com.apple.voice.premium.en-GB.Malcolm` or `com.apple.voice.enhanced.en-US.Samantha`.
 */
export function voiceQuality(voice: Voice): VoiceQuality {
  const text = `${voice.name} ${voice.voiceURI}`.toLowerCase()
  if (text.includes('premium')) return 'premium'
  if (text.includes('enhanced')) return 'enhanced'
  return 'default'
}

const rank: Record<VoiceQuality, number> = { premium: 2, enhanced: 1, default: 0 }

/** `en_GB` (Android) and `en-gb` → `en-GB`-comparable lowercase form. */
const normalizeLang = (lang: string) => lang.replace('_', '-').toLowerCase()
const primary = (lang: string) => normalizeLang(lang).split('-')[0] ?? ''

/**
 * Voices for a studied language, best first: the exact locale before other regions of the same language, then
 * Premium > Enhanced > default, then the system default voice.
 */
export function voicesFor<V extends Voice>(voices: readonly V[], lang: string): V[] {
  const wanted = normalizeLang(lang)
  const exact = (voice: Voice) => (normalizeLang(voice.lang) === wanted ? 1 : 0)
  return voices
    .filter((voice) => primary(voice.lang) === primary(lang))
    .sort(
      (a, b) =>
        exact(b) - exact(a) ||
        rank[voiceQuality(b)] - rank[voiceQuality(a)] ||
        Number(b.default) - Number(a.default) ||
        a.name.localeCompare(b.name),
    )
}

/** The best voice for `lang`, or `null` when no voice speaks that language (architecture.md §4.5). */
export function bestVoice<V extends Voice>(voices: readonly V[], lang: string): V | null {
  return voicesFor(voices, lang)[0] ?? null
}

/** Voice for `lang`: the device preference when it is still installed, otherwise the best one. */
export function pickVoice<V extends Voice>(voices: readonly V[], lang: string, preferredURI?: string): V | null {
  const preferred = preferredURI ? voices.find((voice) => voice.voiceURI === preferredURI) : undefined
  return preferred ?? bestVoice(voices, lang)
}

/** How long to wait for `voiceschanged` when the list starts empty (Safari loads voices asynchronously). */
export const VOICES_TIMEOUT_MS = 3000

/** The installed voices; waits for `voiceschanged` (at most 3 s) when the first list is empty. */
export function loadVoices(synth: SpeechSynthesis | undefined = globalThis.speechSynthesis): Promise<Voice[]> {
  if (!synth) return Promise.resolve([])
  const now = synth.getVoices()
  if (now.length > 0) return Promise.resolve(now)
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      synth.removeEventListener('voiceschanged', done)
      resolve(synth.getVoices())
    }
    const timer = setTimeout(done, VOICES_TIMEOUT_MS)
    synth.addEventListener('voiceschanged', done)
  })
}
