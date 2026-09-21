import { useNavigate, useRouter } from '@tanstack/react-router'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmSheet } from '@/components/ConfirmSheet'
import { ProgressBar } from '@/components/ProgressBar'
import { Button } from '@/components/ui/button'
import type { AccountInfo } from '@/db/meta'
import { getMeta } from '@/db/meta'
import { apiErrorCode } from '@/lib/api'
import { errorMessage } from '@/lib/apiErrors'
import { formatNumber } from '@/lib/intl'
import { engineState, subscribeEngine } from './engine'
import {
  type Counts,
  cancelFirstSync,
  expectedPullRows,
  type FirstSyncPlan,
  getPendingAccount,
  mergeWithAccount,
  planFirstSync,
  replaceWithAccountData,
  runPlannedSync,
} from './firstSync'

type Phase =
  | { name: 'checking' }
  | { name: 'choose'; plan: Extract<FirstSyncPlan, { kind: 'choose' }> }
  | { name: 'syncing'; plan: FirstSyncPlan }
  | { name: 'failed'; code: string; synced: boolean }

/**
 * S-03 First sync (UC-04), shown after every sign-in: decides with `planFirstSync`, asks only when both this device
 * and the account have data, shows a progress bar while the first sync runs, then opens Today.
 */
export function FirstSyncPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const router = useRouter()
  const [pending, setPending] = useState<AccountInfo | null>(null)
  const [phase, setPhase] = useState<Phase>({ name: 'checking' })
  const [confirmUseAccount, setConfirmUseAccount] = useState(false)

  async function run(plan: FirstSyncPlan, sync: () => Promise<void>) {
    setPhase({ name: 'syncing', plan })
    await sync()
    const last = (await getMeta('sync_log'))?.[0]
    if (last?.status === 'error') setPhase({ name: 'failed', code: last.error_code ?? 'unknown', synced: true })
    else await navigate({ to: '/', replace: true })
  }

  async function check() {
    setPhase({ name: 'checking' })
    const account = await getPendingAccount()
    if (!account) {
      await navigate({ to: '/settings/account', replace: true })
      return
    }
    setPending(account)
    try {
      const plan = await planFirstSync(account)
      if (plan.kind === 'choose') setPhase({ name: 'choose', plan })
      else await run(plan, () => runPlannedSync(account, plan))
    } catch (error) {
      setPhase({ name: 'failed', code: apiErrorCode(error), synced: false })
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once when the screen opens
  useEffect(() => {
    void check()
  }, [])

  async function cancel() {
    await cancelFirstSync()
    router.history.back()
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col gap-6 px-4 pt-8 pb-8">
      <h1 className="text-2xl font-semibold">{t('screens.firstSync.title')}</h1>
      {phase.name === 'checking' && <p className="text-muted-foreground">{t('firstSync.checking')}</p>}
      {phase.name === 'choose' && pending && (
        <>
          <Comparison local={phase.plan.local} account={phase.plan.account} />
          <div className="flex flex-col gap-3">
            <Choice
              label={t('firstSync.merge')}
              hint={t('firstSync.mergeHint')}
              primary
              onClick={() => void run(phase.plan, () => mergeWithAccount(pending))}
            />
            <Choice
              label={t('firstSync.useAccount')}
              hint={t('firstSync.useAccountHint')}
              onClick={() => setConfirmUseAccount(true)}
            />
            <Button size="xl" variant="ghost" onClick={() => void cancel()}>
              {t('common.cancel')}
            </Button>
          </div>
          <ConfirmSheet
            open={confirmUseAccount}
            onOpenChange={setConfirmUseAccount}
            title={t('firstSync.useAccountConfirm')}
            description={t('firstSync.useAccountConfirmHint')}
            confirmLabel={t('firstSync.useAccount')}
            onConfirm={() => void run(phase.plan, () => replaceWithAccountData(pending))}
          />
        </>
      )}
      {phase.name === 'syncing' && <Progress plan={phase.plan} />}
      {phase.name === 'failed' && (
        <div className="flex flex-col gap-3">
          <p role="alert" className="text-destructive">
            {errorMessage(phase.code)}
          </p>
          {phase.synced ? (
            <>
              <p className="text-muted-foreground">{t('firstSync.continuesLater')}</p>
              <Button size="xl" onClick={() => void navigate({ to: '/', replace: true })}>
                {t('onboarding.continue')}
              </Button>
            </>
          ) : (
            <>
              <Button size="xl" onClick={() => void check()}>
                {t('firstSync.retry')}
              </Button>
              <Button size="xl" variant="ghost" onClick={() => void cancel()}>
                {t('common.cancel')}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Comparison({ local, account }: { local: Counts; account: Counts }) {
  const { t, i18n } = useTranslation()
  const describe = ({ decks, cards }: Counts) =>
    t('firstSync.counts', {
      decks: t('backup.decks', { count: decks, formatted: formatNumber(decks, i18n.language) }),
      cards: t('backup.cards', { count: cards, formatted: formatNumber(cards, i18n.language) }),
    })
  return (
    <dl className="flex flex-col gap-3 rounded-2xl border bg-card p-4">
      <div>
        <dt className="text-sm text-muted-foreground">{t('firstSync.thisDevice')}</dt>
        <dd className="text-lg font-medium">{describe(local)}</dd>
      </div>
      <div>
        <dt className="text-sm text-muted-foreground">{t('firstSync.inAccount')}</dt>
        <dd className="text-lg font-medium">{describe(account)}</dd>
      </div>
    </dl>
  )
}

function Choice({
  label,
  hint,
  primary = false,
  onClick,
}: {
  label: string
  hint: string
  primary?: boolean
  onClick: () => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <Button size="xl" variant={primary ? 'default' : 'outline'} onClick={onClick}>
        {label}
      </Button>
      <p className="text-sm text-muted-foreground">{hint}</p>
    </div>
  )
}

/** Share of the first sync done: rows sent and received out of those expected (at most 99 % until it ends). */
function Progress({ plan }: { plan: FirstSyncPlan }) {
  const { t } = useTranslation()
  const { progress } = useSyncExternalStore(subscribeEngine, engineState)
  const pushed = progress?.pushed ?? 0
  const toPush = progress?.toPush ?? 0
  const pulled = progress?.pulled ?? 0
  const expected = toPush + Math.max(expectedPullRows(plan.account, toPush), pulled)
  const share = expected === 0 ? 0 : Math.min(0.99, (pushed + pulled) / expected)
  return <ProgressBar label={t('firstSync.syncing')} share={share} />
}
