import { describe, expect, it } from 'vitest'
import { incomingWins } from './lww'

/** (incoming, existing, incoming wins). The same table as the server's `lww_table` test. */
const CASES: [[number, string], [number, string], boolean][] = [
  [[2, 'device-a'], [1, 'device-z'], true], // newer wins, whatever the device
  [[1, 'device-z'], [2, 'device-a'], false], // older loses
  [[5, 'device-b'], [5, 'device-a'], true], // tie: larger device id wins
  [[5, 'device-a'], [5, 'device-b'], false], // tie: smaller device id loses
  [[5, 'device-a'], [5, 'device-a'], false], // identical: no-op
  [[5, 'device-B'], [5, 'device-a'], false], // code unit order: upper case sorts before lower case
  [[5, 'device-aa'], [5, 'device-a'], true], // a longer id with the same prefix is larger
]

describe('incomingWins', () => {
  it.each(CASES)('%j over %j → %s', ([inAt, inBy], [exAt, exBy], expected) => {
    expect(incomingWins({ updated_at: inAt, updated_by: inBy }, { updated_at: exAt, updated_by: exBy })).toBe(expected)
  })
})
