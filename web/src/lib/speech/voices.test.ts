import { afterEach, describe, expect, it, vi } from 'vitest'
import { bestVoice, loadVoices, pickVoice, type Voice, voiceQuality, voicesFor } from './voices'

const voice = (name: string, lang: string, voiceURI = `uri.${name}`, extra: Partial<Voice> = {}): Voice => ({
  name,
  lang,
  voiceURI,
  default: false,
  localService: true,
  ...extra,
})

const gbPremium = voice('Malcolm (Premium)', 'en-GB', 'com.apple.voice.premium.en-GB.Malcolm')
const gbDefault = voice('Daniel', 'en-GB', 'com.apple.voice.compact.en-GB.Daniel')
const usPremium = voice('Zoe (Premium)', 'en-US', 'com.apple.voice.premium.en-US.Zoe')
const usEnhanced = voice('Samantha', 'en-US', 'com.apple.voice.enhanced.en-US.Samantha')
const ru = voice('Milena', 'ru-RU')

describe('voice selection', () => {
  it('detects quality from the name or the URI', () => {
    expect(voiceQuality(gbPremium)).toBe('premium')
    expect(voiceQuality(usEnhanced)).toBe('enhanced')
    expect(voiceQuality(gbDefault)).toBe('default')
  })

  it('prefers en-GB Premium over en-GB default over en-US Premium for en-GB', () => {
    const voices = [usPremium, gbDefault, ru, gbPremium]
    expect(voicesFor(voices, 'en-GB')).toEqual([gbPremium, gbDefault, usPremium])
    expect(bestVoice([usPremium, gbDefault], 'en-GB')).toBe(gbDefault)
  })

  it('falls back to another region of the same language', () => {
    expect(bestVoice([usEnhanced, usPremium, ru], 'en-AU')).toBe(usPremium)
    expect(bestVoice([voice('Android', 'en_GB')], 'en-GB')?.name).toBe('Android')
  })

  it('returns null when no voice speaks the language', () => {
    expect(bestVoice([gbPremium, ru], 'pl-PL')).toBeNull()
  })

  it('uses the device preference while that voice is installed', () => {
    expect(pickVoice([gbPremium, gbDefault], 'en-GB', gbDefault.voiceURI)).toBe(gbDefault)
    expect(pickVoice([gbPremium], 'en-GB', 'uninstalled')).toBe(gbPremium)
  })
})

describe('loadVoices', () => {
  afterEach(() => vi.useRealTimers())

  function fakeSynth(initial: Voice[]) {
    const target = new EventTarget()
    let list = initial
    return Object.assign(target, {
      getVoices: () => list,
      load(voices: Voice[]) {
        list = voices
        target.dispatchEvent(new Event('voiceschanged'))
      },
    })
  }

  it('resolves after voiceschanged when the list starts empty', async () => {
    const synth = fakeSynth([])
    const loading = loadVoices(synth as unknown as SpeechSynthesis)
    synth.load([gbPremium])
    expect(await loading).toEqual([gbPremium])
  })

  it('gives up after 3 s without voices', async () => {
    vi.useFakeTimers()
    const loading = loadVoices(fakeSynth([]) as unknown as SpeechSynthesis)
    await vi.advanceTimersByTimeAsync(3000)
    expect(await loading).toEqual([])
  })
})
