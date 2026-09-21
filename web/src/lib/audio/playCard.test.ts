import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Speaker } from '@/lib/speech/speech'
import { clipResponse, installFakeCaches } from '@/test/caches'
import { download } from './audioCache'
import { playCardAudio, resetAudioPlayer } from './playCard'

const card = (audio_id: string | null) => ({ front: 'read', example: 'I read books.', audio_id })

let system: Speaker & { play: ReturnType<typeof vi.fn> }
let play: ReturnType<typeof vi.spyOn>
let fetch: ReturnType<typeof vi.fn>

function setOnline(onLine: boolean) {
  Object.defineProperty(navigator, 'onLine', { value: onLine, configurable: true })
}

beforeEach(() => {
  installFakeCaches()
  resetAudioPlayer()
  setOnline(true)
  system = { play: vi.fn(async () => 'done' as const) }
  play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:clip'), revokeObjectURL: vi.fn() }))
  fetch = vi.fn(async () => clipResponse('azure'))
  vi.stubGlobal('fetch', fetch)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  setOnline(true)
})

describe('playCardAudio', () => {
  it('speaks a card without audio with the system voice', async () => {
    expect(await playCardAudio(card(null), 'en-GB', system)).toEqual({ via: 'speech', result: 'done' })
    expect(system.play).toHaveBeenCalledWith(card(null), 'en-GB', 'front', {})
    expect(fetch).not.toHaveBeenCalled()
  })

  it('plays a cached clip without the network', async () => {
    await download('a1')
    fetch.mockClear()
    expect(await playCardAudio(card('a1'), 'en-GB', system)).toEqual({ via: 'mp3', result: 'done' })
    expect(fetch).not.toHaveBeenCalled()
    expect(system.play).not.toHaveBeenCalled()
  })

  it('downloads, caches and plays a clip online', async () => {
    expect((await playCardAudio(card('a1'), 'en-GB', system)).via).toBe('mp3')
    expect(fetch).toHaveBeenCalledWith('/api/audio/a1', { credentials: 'same-origin' })
    // Now cached: offline it still plays.
    setOnline(false)
    expect((await playCardAudio(card('a1'), 'en-GB', system)).via).toBe('mp3')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('falls back to speech offline when the clip is not cached', async () => {
    setOnline(false)
    expect((await playCardAudio(card('a1'), 'en-GB', system)).via).toBe('speech')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('falls back to speech when the clip is gone or the network fails', async () => {
    fetch.mockResolvedValueOnce(new Response('{"code":"not_found"}', { status: 404 }))
    expect((await playCardAudio(card('gone'), 'en-GB', system)).via).toBe('speech')
    fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect((await playCardAudio(card('a2'), 'en-GB', system)).via).toBe('speech')
  })

  it('falls back to speech when the browser refuses to play', async () => {
    play.mockRejectedValue(new DOMException('no gesture', 'NotAllowedError'))
    system.play.mockResolvedValue('blocked')
    expect(await playCardAudio(card('a1'), 'en-GB', system)).toEqual({ via: 'speech', result: 'blocked' })
  })

  it('speaks examples with the system voice even when the card has audio', async () => {
    expect((await playCardAudio(card('a1'), 'en-GB', system, 'example')).via).toBe('speech')
    expect(system.play).toHaveBeenCalledWith(card('a1'), 'en-GB', 'example', {})
    expect(fetch).not.toHaveBeenCalled()
  })

  it('plays slower when asked: the clip at a lower playbackRate, else the system voice at that rate', async () => {
    await playCardAudio(card('a1'), 'en-GB', system, 'front', { rate: 0.7 })
    const audio = play.mock.contexts[0] as HTMLAudioElement
    expect(audio.playbackRate).toBe(0.7)
    await playCardAudio(card('a1'), 'en-GB', system)
    expect(audio.playbackRate).toBe(1)

    await playCardAudio(card(null), 'en-GB', system, 'front', { rate: 0.7 })
    expect(system.play).toHaveBeenCalledWith(card(null), 'en-GB', 'front', { rate: 0.7 })
  })
})
