import { useTranslation } from 'react-i18next'
import { PlaceholderPage } from '@/components/PlaceholderPage'
import { Button } from '@/components/ui/button'
import { uiLanguages } from '@/i18n'
import { AudioSettingsSection } from './AudioSettingsSection'
import { DataSection } from './DataSection'

export function SettingsPage() {
  const { t, i18n } = useTranslation()

  // Temporary language switch; the real Settings screen (P1-T12) persists the choice in the settings document.
  return (
    <PlaceholderPage titleKey="screens.settings.title">
      <section className="flex flex-col gap-2">
        <h2 className="font-medium">{t('settings.language')}</h2>
        <div className="flex gap-2">
          {uiLanguages.map((language) => (
            <Button
              key={language}
              size="lg"
              variant={i18n.resolvedLanguage === language ? 'default' : 'outline'}
              aria-pressed={i18n.resolvedLanguage === language}
              onClick={() => i18n.changeLanguage(language)}
            >
              {t(`languages.${language}`)}
            </Button>
          ))}
        </div>
      </section>
      <AudioSettingsSection />
      <DataSection />
    </PlaceholderPage>
  )
}

export function AccountPage() {
  return <PlaceholderPage titleKey="screens.account.title" back />
}

export { VoicesPage } from './VoicesPage'
