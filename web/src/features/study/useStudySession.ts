import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getDeck } from '@/db/decks'
import { answer as answerCard, StudyError, undoAnswer } from '@/db/study'
import { clearStudySession, loadStudyCards, openStudySession, saveStudySession } from '@/db/studySession'
import {
  applyAnswer,
  applyUndo,
  MAX_ANSWER_DURATION_MS,
  type StudySessionParams,
  type StudySessionSnapshot,
  sessionProgress,
  skipCurrent,
} from '@/domain/studySession'
import type { Rating } from '@/domain/types'
import { now } from '@/lib/clock'

export type StudyPhase = 'loading' | 'missing_deck' | 'empty' | 'gate' | 'studying'

type Options = {
  /** Called once the last card is answered. */
  onFinish: (sessionId: string) => void
  /** Called when undo is refused (the answer is no longer the latest one). */
  onUndoFailed: () => void
}

/**
 * Controller of one study session (S-11): opens or resumes the session, records answers through `answer()` /
 * `undoAnswer()` and saves the snapshot to `meta` after every change so a reload resumes at the same card.
 */
export function useStudySession(params: StudySessionParams, { onFinish, onUndoFailed }: Options) {
  const { deck, practice } = params
  const [phase, setPhase] = useState<StudyPhase>('loading')
  const [snapshot, setSnapshot] = useState<StudySessionSnapshot | null>(null)
  const [resumed, setResumed] = useState(false)
  // Every card the session can show: the queue never gains cards, it only reorders them (learning steps, undo).
  const [cardIds, setCardIds] = useState<string[]>([])
  const busy = useRef(false)
  const shownAt = useRef(0)

  useEffect(() => {
    let cancelled = false
    setPhase('loading')
    void (async () => {
      if (deck !== null && !(await getDeck(deck))) {
        if (!cancelled) setPhase('missing_deck')
        return
      }
      const opened = await openStudySession({ deck, practice }, now())
      if (cancelled) return
      const { queue, undo } = opened.snapshot
      setCardIds([...new Set([...queue, ...(undo?.queue ?? [])].map((item) => item.card_id))])
      setSnapshot(opened.snapshot)
      setResumed(opened.resumed)
      setPhase(opened.snapshot.queue.length === 0 ? 'empty' : 'gate')
    })()
    return () => {
      cancelled = true
    }
  }, [deck, practice])

  // A result counts only for the ids it was loaded for: a stale one would make every card look deleted.
  const loaded = useLiveQuery(async () => ({ ids: cardIds, cards: await loadStudyCards(cardIds) }), [cardIds])
  const cards = loaded?.ids === cardIds ? loaded.cards : undefined

  const update = useCallback(
    async (next: StudySessionSnapshot) => {
      await saveStudySession(next)
      setSnapshot(next)
      shownAt.current = now()
      if (next.finished_at !== null) onFinish(next.id)
    },
    [onFinish],
  )

  const current = snapshot?.queue[0]

  // A card deleted since the session was built is skipped.
  useEffect(() => {
    if (phase !== 'studying' || !snapshot || !current || !cards || cards.has(current.card_id)) return
    void update(skipCurrent(snapshot, now()))
  }, [phase, snapshot, current, cards, update])

  const start = useCallback(async () => {
    if (!snapshot) return
    const started = { ...snapshot, last_active_at: now() }
    await saveStudySession(started)
    setSnapshot(started)
    shownAt.current = now()
    setPhase('studying')
  }, [snapshot])

  const answer = useCallback(
    async (rating: Rating) => {
      if (!snapshot || !current || busy.current) return
      busy.current = true
      try {
        const result = await answerCard({
          card_id: current.card_id,
          direction: current.direction,
          rating,
          mode: 'swipe',
          duration_ms: Math.min(MAX_ANSWER_DURATION_MS, Math.max(0, now() - shownAt.current)),
          practice,
        })
        const answered = { log_id: result.log_id, nextDue: result.nextState.due, reinsert: result.reinsert }
        await update(applyAnswer(snapshot, answered, now()))
      } catch (error) {
        if (!(error instanceof StudyError)) throw error
        await update(skipCurrent(snapshot, now()))
      } finally {
        busy.current = false
      }
    },
    [snapshot, current, practice, update],
  )

  const undo = useCallback(async () => {
    if (!snapshot?.undo || busy.current) return
    busy.current = true
    try {
      await undoAnswer(snapshot.undo.log_id)
      await update(applyUndo(snapshot, now()))
    } catch (error) {
      if (!(error instanceof StudyError)) throw error
      await update({ ...snapshot, undo: null })
      onUndoFailed()
    } finally {
      busy.current = false
    }
  }, [snapshot, update, onUndoFailed])

  return {
    phase,
    resumed,
    progress: snapshot ? sessionProgress(snapshot) : null,
    /** The current card first, then the cards behind it. */
    upcoming: snapshot?.queue.slice(0, 3) ?? [],
    cards,
    canUndo: snapshot?.undo != null,
    start,
    answer,
    undo,
    /** Leaving on purpose ends the session: answers are saved, the queue is not resumed. */
    leave: clearStudySession,
  }
}
