import type { Autoplay, Card, Direction } from '@/domain/types'
import { pickVoice } from './voices'

/** `done` also covers an utterance replaced by a newer one; `blocked` = iOS refused speech without a user gesture. */
export type SpeakResult = 'done' | 'blocked' | 'failed'

export type SpeakOptions = { lang: string; rate?: number; voiceURI?: string }

export const DEFAULT_SPEECH_RATE = 1
export const SPEECH_RATE_RANGE = { min: 0.5, max: 1.2, step: 0.1 } as const

export function speechSupported(): boolean {
  return typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined'
}

// Safari drops the events of an utterance that is garbage-collected while speaking; keep the current one alive.
let current: SpeechSynthesisUtterance | null = null

/**
 * Speaks `text` with an explicit `lang` (architecture.md §4.5), the preferred or best voice and `rate`, replacing
 * whatever is being spoken. Synchronous up to `speechSynthesis.speak`, so a tap handler keeps its user gesture.
 */
export function speak(
  text: string,
  { lang, rate = DEFAULT_SPEECH_RATE, voiceURI }: SpeakOptions,
): Promise<SpeakResult> {
  if (!speechSupported() || text.trim() === '') return Promise.resolve('failed')
  speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = lang
  utterance.rate = rate
  const voice = pickVoice(speechSynthesis.getVoices(), lang, voiceURI)
  if (voice) utterance.voice = voice
  current = utterance
  return new Promise((resolve) => {
    const finish = (result: SpeakResult) => {
      if (current === utterance) current = null
      resolve(result)
    }
    utterance.onend = () => finish('done')
    utterance.onerror = (event) => {
      if (event.error === 'not-allowed') finish('blocked')
      else finish(event.error === 'interrupted' || event.error === 'canceled' ? 'done' : 'failed')
    }
    speechSynthesis.speak(utterance)
  })
}

/** Call inside a tap handler (the study Start button): iOS allows speech only after one gesture-started utterance. */
export function unlock(): void {
  if (!speechSupported()) return
  const silent = new SpeechSynthesisUtterance('')
  silent.volume = 0
  speechSynthesis.speak(silent)
}

/**
 * Autoplay during study (S-11): `front` speaks the studied word when a forward card is shown; `front_and_back`
 * also speaks it when a reverse card is turned to its answer. The native-language side is never spoken.
 */
export function shouldSpeak(autoplay: Autoplay, direction: Direction, side: 'front' | 'back'): boolean {
  if (autoplay === 'off') return false
  if (side === 'front') return direction === 'forward'
  return direction === 'reverse' && autoplay === 'front_and_back'
}

export type SpeakPart = 'front' | 'example'

/**
 * Plays a card's word or example in the studied language. The extension point for server audio (P3-T03): a
 * speaker that plays cached audio for `card.audio_id` and falls back to this one.
 */
export type Speaker = {
  play: (card: Pick<Card, 'front' | 'example' | 'audio_id'>, lang: string, part: SpeakPart) => Promise<SpeakResult>
}

export type SpeechPrefs = { rate: number; voicePref: Record<string, string> }

/** The system-voice speaker (Web Speech API) with this device's rate and voice choices. */
export function systemSpeaker({ rate, voicePref }: SpeechPrefs): Speaker {
  return {
    play: (card, lang, part) =>
      speak(part === 'front' ? card.front : (card.example ?? ''), { lang, rate, voiceURI: voicePref[lang] }),
  }
}
