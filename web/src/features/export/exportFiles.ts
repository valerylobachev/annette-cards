import { exportAll, exportDeckCsv } from '@/db/backup'
import { backupFilename } from '@/domain/backup/format'
import { deckCsvFilename } from '@/domain/export/csv'
import type { Deck } from '@/domain/types'
import { shareOrDownload } from '@/lib/share'

/** Full JSON backup through the share sheet or a download (UC-24). */
export async function shareBackup(): Promise<void> {
  const backup = await exportAll()
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' })
  await shareOrDownload(backupFilename(new Date()), blob, 'application/json')
}

/** One deck as CSV in the import format (UC-24). The BOM makes spreadsheet apps read it as UTF-8. */
export async function shareDeckCsv(deck: Deck): Promise<void> {
  const blob = new Blob(['﻿', await exportDeckCsv(deck.id)], { type: 'text/csv;charset=utf-8' })
  await shareOrDownload(deckCsvFilename(deck.name, new Date()), blob, 'text/csv')
}
