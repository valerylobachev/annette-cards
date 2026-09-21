import { useNavigate } from '@tanstack/react-router'
import { parseISO } from 'date-fns'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts'
import { EmptyState } from '@/components/EmptyState'
import { useDecks } from '@/db/hooks'
import { STATS_PERIODS, type Stats, type StatsPeriod } from '@/domain/stats'
import type { StudyDay } from '@/domain/studyDay'
import { Segmented } from '@/features/settings/SettingsList'
import { formatNumber, formatPercent } from '@/lib/intl'
import { Heatmap } from './Heatmap'
import { useStatsData } from './useStatsData'

const CHART_HEIGHT = 180
const chartStyle = { width: '100%', height: CHART_HEIGHT }
const axisTick = { fontSize: 12, fill: 'var(--muted-foreground)' }

/** S-13 Statistics (UC-19): period and deck filters, KPI tiles, charts and the study-day heatmap. */
export function StatsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [period, setPeriod] = useState<StatsPeriod>(30)
  const [deckId, setDeckId] = useState<string | null>(null)
  const decks = useDecks()?.filter((deck) => deck.archived_at === null)
  const stats = useStatsData({ period, deckId })

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-4 pt-4 pb-8">
      <header className="flex min-h-11 items-center">
        <h1 className="text-2xl font-semibold">{t('screens.stats.title')}</h1>
      </header>
      {stats && !stats.hasHistory ? (
        <EmptyState
          message={t('stats.empty')}
          actionLabel={t('stats.goToToday')}
          onAction={() => navigate({ to: '/' })}
        />
      ) : (
        <>
          <div className="flex flex-col gap-3">
            <Segmented<`${StatsPeriod}`>
              label={t('stats.period')}
              value={`${period}`}
              options={STATS_PERIODS.map((value) => ({ value: `${value}`, label: t(`stats.periods.${value}`) }))}
              onChange={(value) => setPeriod(Number(value) as StatsPeriod)}
            />
            <label className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">{t('stats.deck')}</span>
              <select
                value={deckId ?? ''}
                onChange={(event) => setDeckId(event.target.value || null)}
                className="h-11 min-w-0 flex-1 rounded-lg border bg-background px-3"
              >
                <option value="">{t('stats.allDecks')}</option>
                {decks?.map((deck) => (
                  <option key={deck.id} value={deck.id}>
                    {deck.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {stats && <StatsContent stats={stats} period={period} />}
        </>
      )}
    </div>
  )
}

function StatsContent({ stats, period }: { stats: Stats; period: StatsPeriod }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const shortDate = (day: StudyDay) =>
    new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(parseISO(day))
  const minutes = stats.time.reduce((sum, day) => sum + day.minutes, 0)
  const due = stats.forecast.reduce((sum, day) => sum + day.count, 0)
  const studiedDays = stats.year.filter((day) => day.count > 0).length
  const xAxis = <XAxis dataKey="day" tickFormatter={shortDate} tick={axisTick} minTickGap={24} />
  const yAxis = <YAxis allowDecimals={false} tick={axisTick} width={36} />
  const grid = <CartesianGrid vertical={false} stroke="var(--border)" />
  const tooltip = <Tooltip labelFormatter={(day) => shortDate(String(day))} />

  return (
    <>
      <section aria-label={t('stats.kpis')} className="grid grid-cols-2 gap-3">
        <Kpi label={t('stats.totalCards')} value={formatNumber(stats.kpis.totalCards, locale)} />
        <Kpi label={t('stats.matureCards')} value={formatNumber(stats.kpis.matureCards, locale)} />
        <Kpi label={t('stats.currentStreak')} value={t('today.streak', { count: stats.kpis.currentStreak })} />
        <Kpi label={t('stats.longestStreak')} value={t('today.streak', { count: stats.kpis.longestStreak })} />
      </section>

      <ChartCard title={t('stats.reviews')} summary={t('stats.answers', { count: stats.total })}>
        <BarChart responsive data={stats.reviews} style={chartStyle}>
          {grid}
          {xAxis}
          {yAxis}
          {tooltip}
          <Legend wrapperStyle={{ fontSize: 12 }} itemSorter={null} />
          <Bar dataKey="again" name={t('study.ratings.1')} stackId="r" fill="var(--again)" isAnimationActive={false} />
          <Bar dataKey="hard" name={t('study.ratings.2')} stackId="r" fill="var(--hard)" isAnimationActive={false} />
          <Bar dataKey="good" name={t('study.ratings.3')} stackId="r" fill="var(--good)" isAnimationActive={false} />
          <Bar dataKey="easy" name={t('study.ratings.4')} stackId="r" fill="var(--easy)" isAnimationActive={false} />
        </BarChart>
      </ChartCard>

      <ChartCard title={t('stats.forecast')} summary={t('stats.dueTotal', { count: due })}>
        <BarChart responsive data={stats.forecast} style={chartStyle}>
          {grid}
          {xAxis}
          {yAxis}
          {tooltip}
          <Bar dataKey="count" name={t('stats.due')} fill="var(--primary)" isAnimationActive={false} />
        </BarChart>
      </ChartCard>

      <ChartCard title={t('stats.states')} summary={t('stats.statesHint')} chart={false}>
        <StateBars states={stats.states} locale={locale} />
      </ChartCard>

      <ChartCard
        title={t('stats.retention')}
        summary={
          stats.periodRetention === null
            ? t('stats.noRetention')
            : t('stats.retentionValue', { value: formatPercent(stats.periodRetention, locale) })
        }
      >
        <LineChart
          responsive
          data={stats.retention.map(({ day, retention }) => ({
            day,
            retention: retention === null ? null : Math.round(retention * 100),
          }))}
          style={chartStyle}
        >
          {grid}
          {xAxis}
          <YAxis domain={[0, 100]} unit="%" tick={axisTick} width={44} />
          {tooltip}
          <Line
            dataKey="retention"
            name={t('stats.retention')}
            stroke="var(--good)"
            strokeWidth={2}
            connectNulls
            dot={period === 7}
            isAnimationActive={false}
          />
        </LineChart>
      </ChartCard>

      <ChartCard title={t('stats.time')} summary={t('stats.minutes', { count: Math.round(minutes) })}>
        <BarChart responsive data={stats.time} style={chartStyle}>
          {grid}
          {xAxis}
          <YAxis tick={axisTick} width={36} />
          {tooltip}
          <Bar dataKey="minutes" name={t('stats.minutesLabel')} fill="var(--easy)" isAnimationActive={false} />
        </BarChart>
      </ChartCard>

      {period === 365 && (
        <ChartCard title={t('stats.heatmap')} summary={t('stats.studyDays', { count: studiedDays })}>
          <Heatmap year={stats.year} locale={locale} />
        </ChartCard>
      )}
    </>
  )
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border bg-card p-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
    </div>
  )
}

type ChartCardProps = {
  title: string
  summary?: string
  /** A chart is hidden from VoiceOver, which reads the summary instead; a text list (`false`) is not. */
  chart?: boolean
  children: ReactNode
}

/** A chart with its title and a one-line text summary. */
function ChartCard({ title, summary, chart = true, children }: ChartCardProps) {
  return (
    <section className="flex flex-col gap-2 rounded-2xl border bg-card p-4">
      <h2 className="font-medium">{title}</h2>
      {summary && <p className="text-sm text-muted-foreground">{summary}</p>}
      <div aria-hidden={chart} className="min-w-0">
        {children}
      </div>
    </section>
  )
}

const STATE_COLORS = { new: 'bg-primary', learning: 'bg-hard', young: 'bg-easy', mature: 'bg-good' } as const

/** Card states as labelled bars (the count is always written, never color only). */
function StateBars({ states, locale }: { states: Stats['states']; locale: string }) {
  const { t } = useTranslation()
  const max = Math.max(1, ...Object.values(states))
  return (
    <ul aria-label={t('stats.states')} className="flex flex-col gap-2">
      {(['new', 'learning', 'young', 'mature'] as const).map((key) => (
        <li key={key} className="grid grid-cols-[6.5rem_1fr_3rem] items-center gap-2 text-sm">
          <span>{t(`stats.stateNames.${key}`)}</span>
          <span className="h-3 overflow-hidden rounded-full bg-secondary">
            <span
              className={`block h-full rounded-full ${STATE_COLORS[key]}`}
              style={{ width: `${(states[key] / max) * 100}%` }}
            />
          </span>
          <span className="text-right tabular-nums">{formatNumber(states[key], locale)}</span>
        </li>
      ))}
    </ul>
  )
}
