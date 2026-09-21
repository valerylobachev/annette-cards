import { parseISO } from 'date-fns'
import { useTranslation } from 'react-i18next'
import { heatLevel } from '@/domain/stats'
import type { StudyDay } from '@/domain/studyDay'

const CELL = 12
const GAP = 2
const LEVEL_STYLE = ['fill-secondary', 'fill-good/30', 'fill-good/55', 'fill-good/80', 'fill-good'] as const

/** Monday-first weekday: 0 Monday … 6 Sunday. */
const weekday = (day: StudyDay) => (parseISO(day).getDay() + 6) % 7

/**
 * Calendar heatmap of the last year (S-13): one column per week, Monday on top, today in the last column; the shade
 * follows `heatLevel`. Each cell has a tooltip with the date and the number of answers.
 */
export function Heatmap({ year, locale }: { year: { day: StudyDay; count: number }[]; locale: string }) {
  const { t } = useTranslation()
  const first = year[0]
  if (!first) return null
  const offset = weekday(first.day)
  const weeks = Math.ceil((year.length + offset) / 7)
  const size = CELL + GAP
  const date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' })
  return (
    <div className="flex flex-col gap-2">
      <svg aria-hidden viewBox={`0 0 ${weeks * size} ${7 * size}`} className="w-full" data-testid="heatmap">
        {year.map(({ day, count }, index) => (
          <rect
            key={day}
            x={Math.floor((index + offset) / 7) * size}
            y={((index + offset) % 7) * size}
            width={CELL}
            height={CELL}
            rx={2}
            className={LEVEL_STYLE[heatLevel(count)]}
          >
            <title>{t('stats.dayAnswers', { count, date: date.format(parseISO(day)) })}</title>
          </rect>
        ))}
      </svg>
      <div className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
        {t('stats.less')}
        {LEVEL_STYLE.map((style) => (
          <svg aria-hidden key={style} viewBox={`0 0 ${CELL} ${CELL}`} className="size-3">
            <rect width={CELL} height={CELL} rx={2} className={style} />
          </svg>
        ))}
        {t('stats.more')}
      </div>
    </div>
  )
}
