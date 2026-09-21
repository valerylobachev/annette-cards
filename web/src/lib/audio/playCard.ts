import type { Card } from '@/domain/types'
import { type Speaker, type SpeakPart, type SpeakResult, speechSupported } from '@/lib/speech/speech'
import { cachedOrDownloaded } from './audioCache'

/**
 * Playback of server audio (architecture.md §4.5): one reused `<audio>` element plays the clip from a blob URL;
 * without a clip (no `audio_id`, offline and not cached, a failed download or a refused `play()`) the system voice
 * speaks instead.
 */

let element: HTMLAudioElement | null = null
let objectUrl: string | null = null
let unlocked = false

function audioElement(): HTMLAudioElement {
  element ??= new Audio()
  return element
}

function setSource(blob: Blob) {
  if (objectUrl) URL.revokeObjectURL(objectUrl)
  objectUrl = URL.createObjectURL(blob)
  audioElement().src = objectUrl
}

/** 50 ms of silence as WAV (8 kHz, 8-bit mono), for the unlock below. */
function silence(): Blob {
  const samples = 400
  const header = new DataView(new ArrayBuffer(44))
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) header.setUint8(offset + i, value.charCodeAt(i))
  }
  text(0, 'RIFF')
  header.setUint32(4, 36 + samples, true)
  text(8, 'WAVEfmt ')
  header.setUint32(16, 16, true) // fmt chunk size
  header.setUint16(20, 1, true) // PCM
  header.setUint16(22, 1, true) // mono
  header.setUint32(24, 8000, true) // sample rate
  header.setUint32(28, 8000, true) // byte rate
  header.setUint16(32, 1, true) // block align
  header.setUint16(34, 8, true) // bits per sample
  text(36, 'data')
  header.setUint32(40, samples, true)
  return new Blob([header.buffer, new Uint8Array(samples).fill(128)], { type: 'audio/wav' })
}

/**
 * Call synchronously inside a tap handler (the study Start button, a speaker tap). iOS lets an `<audio>` element
 * play without a gesture once it has played inside one, so autoplayed clips work later in the session.
 */
export function unlockAudio(): void {
  if (unlocked || typeof Audio === 'undefined') return
  try {
    setSource(silence())
    Promise.resolve(audioElement().play()).then(
      () => {
        unlocked = true
      },
      (error: unknown) => {
        // Interrupted by the clip that the same tap started: the element did start inside the gesture.
        if (error instanceof DOMException && error.name === 'AbortError') unlocked = true
      },
    )
  } catch {
    // Best effort: a browser without blob URLs must not break the tap that called this.
  }
}

/** Stops a clip that is playing (before the system voice speaks). */
export function stopAudio(): void {
  element?.pause()
}

/** Starts a clip; `blocked` when the browser refuses to play without a user gesture. */
async function playClip(blob: Blob): Promise<SpeakResult> {
  if (speechSupported()) speechSynthesis.cancel()
  const audio = audioElement()
  audio.pause()
  setSource(blob)
  try {
    await audio.play()
    return 'done'
  } catch (error) {
    return error instanceof DOMException && error.name === 'NotAllowedError' ? 'blocked' : 'failed'
  }
}

export type PlayOutcome = { via: 'mp3' | 'speech'; result: SpeakResult }

/**
 * Plays the card's word: its server clip when it has one (cached, else downloaded and cached while online), else
 * the system voice (`system`). Examples are always spoken by the system voice.
 */
export async function playCardAudio(
  card: Pick<Card, 'front' | 'example' | 'audio_id'>,
  lang: string,
  system: Speaker,
  part: SpeakPart = 'front',
): Promise<PlayOutcome> {
  if (part === 'front' && card.audio_id) {
    unlockAudio()
    const response = await cachedOrDownloaded(card.audio_id)
    if (response) {
      const result = await playClip(await response.blob())
      if (result === 'done') return { via: 'mp3', result }
    }
  }
  stopAudio()
  return { via: 'speech', result: await system.play(card, lang, part) }
}

/** A speaker that plays server audio in front of `system` (the `Speaker` extension point of Phase 1). */
export function audioSpeaker(system: Speaker): Speaker {
  return { play: async (card, lang, part) => (await playCardAudio(card, lang, system, part)).result }
}

/** Tests only. */
export function resetAudioPlayer() {
  element = null
  objectUrl = null
  unlocked = false
}
