import { Link, useRouter } from '@tanstack/react-router'
import { ChevronLeft } from 'lucide-react'
import { type FormEvent, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { changePassword, logoutOthers } from '@/api/endpoints/auth/auth'
import { ConfirmSheet } from '@/components/ConfirmSheet'
import { FormField } from '@/components/FormField'
import { OfflineHint } from '@/components/OfflineHint'
import { useSnackbar } from '@/components/Snackbar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { apiErrorCode, callApi, isUnauthorized } from '@/lib/api'
import { errorMessage } from '@/lib/apiErrors'
import { SettingsGroup } from '../settings/SettingsList'
import { SyncSection } from '../sync/SyncSection'
import { type AccountInfo, markSessionExpired, useAccount } from './account'
import { InvitesSection } from './InvitesSection'

/** S-15 Account & sync: sign-in prompt, or the account, the sync block, password change and admin invites. */
export function AccountPage() {
  const { t } = useTranslation()
  const router = useRouter()
  const state = useAccount()

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-4 pt-4 pb-8">
      <header className="flex min-h-11 items-center gap-2">
        <Button variant="ghost" size="icon-xl" aria-label={t('common.back')} onClick={() => router.history.back()}>
          <ChevronLeft className="size-6" />
        </Button>
        <h1 className="text-2xl font-semibold">{t('screens.account.title')}</h1>
      </header>
      {state?.account === null && <SignedOut />}
      {state?.account && (
        <>
          {state.sessionExpired && <SessionExpiredBanner />}
          <AccountGroup account={state.account} />
          {!state.sessionExpired && <SyncSection />}
          {state.account.is_admin && !state.sessionExpired && <InvitesSection />}
        </>
      )}
    </div>
  )
}

function SignedOut() {
  const { t } = useTranslation()
  return (
    <section className="flex flex-col gap-4">
      <p className="text-muted-foreground">{t('account.signedOut')}</p>
      <Button size="xl" asChild>
        <Link to="/signin">{t('auth.signIn')}</Link>
      </Button>
      <Button size="xl" variant="outline" asChild>
        <Link to="/register">{t('auth.register')}</Link>
      </Button>
    </section>
  )
}

function SessionExpiredBanner() {
  const { t } = useTranslation()
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-2xl border border-destructive/40 bg-destructive/5 p-4">
      <p>{t('account.sessionExpired')}</p>
      <Button size="xl" asChild>
        <Link to="/signin">{t('account.signInAgain')}</Link>
      </Button>
    </div>
  )
}

function AccountGroup({ account }: { account: AccountInfo }) {
  const { t } = useTranslation()
  const snackbar = useSnackbar()
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [confirmOthers, setConfirmOthers] = useState(false)

  async function signOutOthers() {
    try {
      await callApi(() => logoutOthers())
      snackbar.show({ message: t('account.othersSignedOut') })
    } catch (error) {
      if (isUnauthorized(error)) await markSessionExpired()
      snackbar.show({ message: errorMessage(apiErrorCode(error)) })
    }
  }

  return (
    <SettingsGroup title={t('account.section')}>
      <div className="flex flex-col gap-0.5 px-4 py-3">
        <span className="font-medium">{account.display_name}</span>
        <span className="text-sm break-all text-muted-foreground">{account.email}</span>
      </div>
      <div className="flex flex-col gap-2 p-4">
        <OfflineHint>
          {(offline) => (
            <Button size="xl" variant="outline" disabled={offline} onClick={() => setPasswordOpen(true)}>
              {t('account.changePassword')}
            </Button>
          )}
        </OfflineHint>
        <OfflineHint>
          {(offline) => (
            <Button size="xl" variant="outline" disabled={offline} onClick={() => setConfirmOthers(true)}>
              {t('account.signOutOthers')}
            </Button>
          )}
        </OfflineHint>
      </div>
      <ChangePasswordSheet open={passwordOpen} onOpenChange={setPasswordOpen} />
      <ConfirmSheet
        open={confirmOthers}
        onOpenChange={setConfirmOthers}
        title={t('account.signOutOthersConfirm')}
        description={t('account.signOutOthersHint')}
        confirmLabel={t('account.signOutOthers')}
        onConfirm={() => void signOutOthers()}
      />
    </SettingsGroup>
  )
}

function ChangePasswordSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation()
  const id = useId()
  const snackbar = useSnackbar()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function close(open: boolean) {
    if (!open) {
      setCurrent('')
      setNext('')
      setError(null)
    }
    onOpenChange(open)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await callApi(() => changePassword({ current_password: current, new_password: next }))
      close(false)
      snackbar.show({ message: t('account.passwordChanged') })
    } catch (caught) {
      setError(apiErrorCode(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent side="bottom" className="mx-auto max-w-[480px]">
        <SheetHeader>
          <SheetTitle className="text-lg">{t('account.changePassword')}</SheetTitle>
          <SheetDescription>{t('account.changePasswordHint')}</SheetDescription>
        </SheetHeader>
        <form className="flex flex-col gap-4 px-4 pb-4" onSubmit={submit} noValidate>
          <FormField id={`${id}-current`} label={t('account.currentPassword')}>
            <Input
              id={`${id}-current`}
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
            />
          </FormField>
          <FormField id={`${id}-new`} label={t('account.newPassword')} hint={t('auth.passwordHint', { min: 10 })}>
            <Input
              id={`${id}-new`}
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(event) => setNext(event.target.value)}
            />
          </FormField>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage(error)}
            </p>
          )}
          <Button type="submit" size="xl" disabled={busy || current === '' || next === ''}>
            {t('common.save')}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  )
}
