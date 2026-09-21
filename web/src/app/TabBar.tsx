import { Link, type LinkProps } from '@tanstack/react-router'
import type { ParseKeys } from 'i18next'
import { BarChart3, CalendarCheck, Layers, type LucideIcon, Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'

type Tab = { to: LinkProps['to']; labelKey: ParseKeys; icon: LucideIcon; exact?: boolean }

const tabs: Tab[] = [
  { to: '/', labelKey: 'nav.today', icon: CalendarCheck, exact: true },
  { to: '/decks', labelKey: 'nav.decks', icon: Layers },
  { to: '/stats', labelKey: 'nav.stats', icon: BarChart3 },
  { to: '/settings', labelKey: 'nav.settings', icon: Settings },
]

export function TabBar() {
  const { t } = useTranslation()

  return (
    <nav
      aria-label={t('nav.label')}
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-safe pl-safe pr-safe backdrop-blur"
    >
      <ul className="mx-auto flex max-w-[720px]">
        {tabs.map(({ to, labelKey, icon: Icon, exact }) => (
          <li key={to} className="flex-1">
            <Link
              to={to}
              activeOptions={{ exact }}
              className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs text-muted-foreground data-[status=active]:text-primary"
            >
              <Icon className="size-6" aria-hidden />
              <span>{t(labelKey)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
