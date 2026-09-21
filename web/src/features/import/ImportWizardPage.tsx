import { useNavigate, useRouter, useSearch } from '@tanstack/react-router'
import { FileUp } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FormField } from '@/components/FormField'
import { ProgressBar } from '@/components/ProgressBar'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { listCards } from '@/db/cards'
import { useDecks } from '@/db/hooks'
import { type DuplicateStrategy, type ImportCounts, importRows } from '@/db/importCards'
import { autoMap, defaultMapping, IMPORT_FIELDS, type ImportField } from '@/domain/import/mapping'
import type { Delimiter, ParsedTable } from '@/domain/import/parse'
import { errorReportCsv, type ImportError, summarize, type ValidatedRow } from '@/domain/import/validate'
import { normalizeFront } from '@/domain/normalize'
import type { Deck } from '@/domain/types'
import { DeckFormSheet } from '@/features/decks/DeckFormSheet'
import { formatNumber } from '@/lib/intl'
import { downloadFile } from '@/lib/share'
import { runImportWorker } from './runWorker'

const PREVIEW_ROWS = 10
const ERRORS_SHOWN = 5

type Step =
  | { name: 'source' }
  | { name: 'mapping'; table: ParsedTable }
  | { name: 'validation'; table: ParsedTable; mapping: ImportField[]; rows: ValidatedRow[] }
  | { name: 'result'; counts: ImportCounts }

type Busy = { label: string; share: number }

/** S-10 Import wizard: source → preview & mapping → validation → result (UC-10). */
export function ImportWizardPage() {
  const { t } = useTranslation()
  const router = useRouter()
  const navigate = useNavigate()
  const search = useSearch({ from: '/import' })
  const decks = useDecks()
  const [deckId, setDeckId] = useState<string | null>(search.deck ?? null)
  const [step, setStep] = useState<Step>({ name: 'source' })
  const [busy, setBusy] = useState<Busy | null>(null)

  if (!decks) return null
  const choices = decks.filter((deck) => deck.archived_at === null)
  const deck = choices.find((d) => d.id === deckId) ?? choices[0]

  function close() {
    if (router.history.canGoBack()) router.history.back()
    else navigate({ to: '/decks' })
  }

  async function parse(source: { bytes: ArrayBuffer } | { text: string }): Promise<string | null> {
    setBusy({ label: t('import.progress.reading'), share: 0 })
    try {
      const result = await runImportWorker({ type: 'parse', ...source }, (share) =>
        setBusy({ label: t('import.progress.reading'), share }),
      )
      if (result.type === 'failed') return t(`import.errors.${result.code}`)
      if (result.type === 'parsed') setStep({ name: 'mapping', table: result.table })
      return null
    } catch {
      return t('import.errors.unreadable')
    } finally {
      setBusy(null)
    }
  }

  async function validate(table: ParsedTable, mapping: ImportField[], hasHeader: boolean) {
    if (!deck) return
    setBusy({ label: t('import.progress.checking'), share: 0 })
    try {
      const existingFronts = (await listCards(deck.id)).map((card) => normalizeFront(card.front))
      const result = await runImportWorker(
        { type: 'validate', rows: hasHeader ? table.rows.slice(1) : table.rows, mapping, existingFronts },
        (share) => setBusy({ label: t('import.progress.checking'), share }),
      )
      if (result.type === 'validated') setStep({ name: 'validation', table, mapping, rows: result.rows })
    } finally {
      setBusy(null)
    }
  }

  async function runImport(rows: ValidatedRow[], strategy: DuplicateStrategy) {
    if (!deck) return
    const cards = rows.flatMap((row) => (row.status === 'error' ? [] : [row.card]))
    setBusy({ label: t('import.progress.importing'), share: 0 })
    try {
      const counts = await importRows(deck.id, cards, strategy, (share) =>
        setBusy({ label: t('import.progress.importing'), share }),
      )
      setStep({ name: 'result', counts })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col">
      <header className="sticky top-0 z-10 flex min-h-14 items-center gap-2 border-b bg-background px-2">
        {step.name !== 'result' && (
          <Button variant="ghost" size="xl" onClick={close}>
            {t('common.cancel')}
          </Button>
        )}
        <h1 className="flex-1 truncate text-center text-lg font-semibold">{t('screens.import.title')}</h1>
        {step.name !== 'result' && (
          <span className="px-4 text-sm text-muted-foreground">
            {t('import.stepOf', { step: stepNumber(step), total: 4 })}
          </span>
        )}
      </header>

      {busy && (
        <div className="px-4 pt-4">
          <ProgressBar label={busy.label} share={busy.share} />
        </div>
      )}
      {/* Hidden, not unmounted, while busy: the step keeps its input if the work fails. */}
      <div hidden={busy !== null} className="flex flex-col gap-5 px-4 pt-4 pb-8">
        {step.name === 'source' ? (
          <SourceStep decks={choices} deck={deck} onDeckChange={setDeckId} onParse={parse} />
        ) : step.name === 'mapping' ? (
          <MappingStep
            table={step.table}
            onBack={() => setStep({ name: 'source' })}
            onNext={(mapping, hasHeader) => validate(step.table, mapping, hasHeader)}
          />
        ) : step.name === 'validation' ? (
          <ValidationStep
            rows={step.rows}
            onBack={() => setStep({ name: 'mapping', table: step.table })}
            onImport={(strategy) => runImport(step.rows, strategy)}
          />
        ) : (
          deck && <ResultStep deck={deck} counts={step.counts} />
        )}
      </div>
    </div>
  )
}

function stepNumber(step: Step) {
  return { source: 1, mapping: 2, validation: 3, result: 4 }[step.name]
}

type SourceProps = {
  decks: Deck[]
  deck: Deck | undefined
  onDeckChange: (id: string) => void
  onParse: (source: { bytes: ArrayBuffer } | { text: string }) => Promise<string | null>
}

function SourceStep({ decks, deck, onDeckChange, onParse }: SourceProps) {
  const { t } = useTranslation()
  const fileInputId = useId()
  const fileInput = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [text, setText] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canContinue = deck !== undefined && (file !== null || text.trim() !== '')

  async function next() {
    const source = file ? { bytes: await file.arrayBuffer() } : { text }
    setError(await onParse(source))
  }

  return (
    <>
      <FormField id="import-deck" label={t('import.source.deck')}>
        <div className="flex gap-2">
          <select
            id="import-deck"
            className="h-11 min-w-0 flex-1 rounded-lg border border-input bg-transparent px-3"
            value={deck?.id ?? ''}
            onChange={(event) => onDeckChange(event.target.value)}
          >
            {decks.length === 0 && <option value="">{t('import.source.noDeck')}</option>}
            {decks.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.name}
              </option>
            ))}
          </select>
          <Button type="button" size="xl" variant="outline" onClick={() => setCreating(true)}>
            {t('import.source.newDeck')}
          </Button>
        </div>
      </FormField>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{t('import.source.file')}</span>
        <input
          id={fileInputId}
          ref={fileInput}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
          aria-label={t('import.source.file')}
          className="sr-only"
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null)
            setError(null)
          }}
        />
        <Button type="button" size="xl" variant="outline" onClick={() => fileInput.current?.click()}>
          <FileUp className="size-4" aria-hidden />
          {file ? file.name : t('import.source.chooseFile')}
        </Button>
        <p className="text-sm text-muted-foreground">{t('import.source.fileHint')}</p>
      </div>

      {!file && (
        <FormField id="import-text" label={t('import.source.paste')}>
          <Textarea
            id="import-text"
            rows={6}
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            placeholder={t('import.source.pastePlaceholder')}
            value={text}
            onChange={(event) => {
              setText(event.target.value)
              setError(null)
            }}
          />
        </FormField>
      )}

      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}

      <Button size="xl" disabled={!canContinue} onClick={next}>
        {t('import.next')}
      </Button>

      <DeckFormSheet
        mode="create"
        open={creating}
        onOpenChange={setCreating}
        onSaved={(saved) => onDeckChange(saved.id)}
      />
    </>
  )
}

const delimiterKeys: Record<Delimiter, 'comma' | 'semicolon' | 'tab'> = { ',': 'comma', ';': 'semicolon', '\t': 'tab' }

type MappingProps = {
  table: ParsedTable
  onBack: () => void
  onNext: (mapping: ImportField[], hasHeader: boolean) => void
}

function MappingStep({ table, onBack, onNext }: MappingProps) {
  const { t } = useTranslation()
  const headerRow = table.rows[0] ?? []
  const [hasHeader, setHasHeader] = useState(table.hasHeaderGuess)
  const [mapping, setMapping] = useState<ImportField[]>(() =>
    table.hasHeaderGuess ? autoMap(headerRow) : defaultMapping(headerRow.length),
  )
  const preview = table.rows.slice(hasHeader ? 1 : 0, (hasHeader ? 1 : 0) + PREVIEW_ROWS)
  const missing = (['front', 'back'] as const).filter((field) => !mapping.includes(field))

  function toggleHeader(checked: boolean) {
    setHasHeader(checked)
    setMapping(checked ? autoMap(headerRow) : defaultMapping(headerRow.length))
  }

  function mapColumn(index: number, field: ImportField) {
    // A card field belongs to one column only: the column that had it before becomes ignored.
    setMapping((current) =>
      current.map((value, i) => (i === index ? field : value === field && field !== 'ignore' ? 'ignore' : value)),
    )
  }

  return (
    <>
      <p className="text-sm text-muted-foreground">
        {t('import.mapping.detected', {
          delimiter: t(`import.mapping.delimiters.${delimiterKeys[table.delimiter]}`),
          encoding: 'UTF-8',
        })}
      </p>

      <label className="flex min-h-11 items-center gap-3">
        <input
          type="checkbox"
          className="size-5 accent-primary"
          checked={hasHeader}
          onChange={(event) => toggleHeader(event.target.checked)}
        />
        {t('import.mapping.hasHeader')}
      </label>

      <div className="-mx-4 overflow-x-auto px-4">
        <table className="w-max min-w-full border-collapse text-sm">
          <thead>
            <tr>
              {mapping.map((field, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional and never reordered
                <th key={index} className="border-b p-1 text-left align-bottom font-normal">
                  {hasHeader && (
                    <span className="block truncate px-1 pb-1 text-xs text-muted-foreground">{headerRow[index]}</span>
                  )}
                  <select
                    aria-label={t('import.mapping.column', { number: index + 1 })}
                    className="h-11 rounded-lg border border-input bg-transparent px-2"
                    value={field}
                    onChange={(event) => mapColumn(index, event.target.value as ImportField)}
                  >
                    {IMPORT_FIELDS.map((option) => (
                      <option key={option} value={option}>
                        {t(`import.fields.${option}`)}
                      </option>
                    ))}
                  </select>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.map((row, rowIndex) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: preview rows are a fixed slice
              <tr key={rowIndex} className="border-b">
                {row.map((cell, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional
                  <td key={index} className="max-w-48 truncate p-2">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {missing.length > 0 && (
        <p role="alert" className="text-sm text-destructive">
          {t('import.mapping.required')}
        </p>
      )}

      <div className="flex gap-2">
        <Button size="xl" variant="outline" onClick={onBack}>
          {t('common.back')}
        </Button>
        <Button size="xl" className="flex-1" disabled={missing.length > 0} onClick={() => onNext(mapping, hasHeader)}>
          {t('import.next')}
        </Button>
      </div>
    </>
  )
}

const strategies: DuplicateStrategy[] = ['skip', 'update', 'import_anyway']

type ValidationProps = {
  rows: ValidatedRow[]
  onBack: () => void
  onImport: (strategy: DuplicateStrategy) => void
}

function ValidationStep({ rows, onBack, onImport }: ValidationProps) {
  const { t, i18n } = useTranslation()
  const [strategy, setStrategy] = useState<DuplicateStrategy>('skip')
  const summary = summarize(rows)
  const importable = summary.ready + (strategy === 'skip' ? 0 : summary.duplicates)
  const errorRows = rows.filter((row) => row.status === 'error')
  const number = (value: number) => formatNumber(value, i18n.language)

  function describe(error: ImportError) {
    if (error.code === 'too_long') {
      return t('import.errors.too_long', { field: t(`import.fields.${error.field ?? 'front'}`), max: error.max })
    }
    return t(`import.errors.${error.code}`)
  }

  function downloadReport() {
    const csv = errorReportCsv(rows, [t('import.report.row'), t('import.report.reason')], describe)
    downloadFile('import-errors.csv', new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  }

  return (
    <>
      <dl className="grid grid-cols-3 gap-2 text-center">
        {(
          [
            ['ready', summary.ready],
            ['duplicates', summary.duplicates],
            ['errors', summary.errors],
          ] as const
        ).map(([name, count]) => (
          <div key={name} className="rounded-xl border p-3">
            <dt className="text-sm text-muted-foreground">{t(`import.validation.${name}`)}</dt>
            <dd className="text-2xl font-semibold">{number(count)}</dd>
          </div>
        ))}
      </dl>

      {summary.duplicates > 0 && (
        <fieldset className="flex flex-col gap-1">
          <legend className="pb-1 font-medium">{t('import.validation.duplicateStrategy')}</legend>
          {strategies.map((option) => (
            <label key={option} className="flex min-h-11 items-center gap-3">
              <input
                type="radio"
                name="duplicate-strategy"
                className="size-5 accent-primary"
                checked={strategy === option}
                onChange={() => setStrategy(option)}
              />
              {t(`import.validation.strategies.${option}`)}
            </label>
          ))}
        </fieldset>
      )}

      {errorRows.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-medium">{t('import.validation.errorList')}</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {errorRows.slice(0, ERRORS_SHOWN).map((row) => (
              <li key={row.row}>
                {t('import.validation.rowError', {
                  row: row.row,
                  reason: row.status === 'error' ? row.errors.map(describe).join('; ') : '',
                })}
              </li>
            ))}
          </ul>
          {errorRows.length > ERRORS_SHOWN && (
            <p className="text-sm text-muted-foreground">
              {t('import.validation.moreErrors', { count: errorRows.length - ERRORS_SHOWN })}
            </p>
          )}
          <Button size="xl" variant="outline" onClick={downloadReport}>
            {t('import.validation.downloadReport')}
          </Button>
        </section>
      )}

      {importable === 0 && (
        <p role="alert" className="text-destructive">
          {t('import.validation.nothingToImport')}
        </p>
      )}

      <div className="flex gap-2">
        <Button size="xl" variant="outline" onClick={onBack}>
          {t('common.back')}
        </Button>
        <Button size="xl" className="flex-1" disabled={importable === 0} onClick={() => onImport(strategy)}>
          {t('import.validation.import', { count: importable })}
        </Button>
      </div>
    </>
  )
}

function ResultStep({ deck, counts }: { deck: Deck; counts: ImportCounts }) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  return (
    <div className="flex flex-col gap-4 py-8 text-center">
      <p className="text-xl font-semibold">
        {t('import.result.imported', { count: counts.inserted, deck: deck.name })}
      </p>
      {counts.updated > 0 && (
        <p className="text-muted-foreground">{t('import.result.updated', { count: counts.updated })}</p>
      )}
      {counts.skipped > 0 && (
        <p className="text-muted-foreground">{t('import.result.skipped', { count: counts.skipped })}</p>
      )}
      <Button size="xl" onClick={() => navigate({ to: '/study', search: { deck: deck.id } })}>
        {t('import.result.studyNow')}
      </Button>
      <Button
        size="xl"
        variant="outline"
        onClick={() => navigate({ to: '/decks/$deckId', params: { deckId: deck.id }, replace: true })}
      >
        {t('import.result.openDeck')}
      </Button>
    </div>
  )
}
