import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Share } from 'lucide-react'
import { type FormEvent, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createInvite, listInvites, revokeInvite } from '@/api/endpoints/admin/admin'
import type { InviteStatus, InviteSummary } from '@/api/model'
import { ConfirmSheet } from '@/components/ConfirmSheet'
import { FormField } from '@/components/FormField'
import { OfflineHint } from '@/components/OfflineHint'
import { useSnackbar } from '@/components/Snackbar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { apiErrorCode, callApi } from '@/lib/api'
import { errorMessage } from '@/lib/apiErrors'
import { relativeTime } from '@/lib/intl'
import { useOnline } from '@/lib/useOnline'
import { cn } from '@/lib/utils'
import { SettingsGroup } from '../settings/SettingsList'

const INVITES_KEY = ['admin', 'invites'] as const
const DEFAULT_DAYS = 7
const DAY_CHOICES = [1, 3, 7, 14, 30, 90] as const

/** The registration link an invitee opens. */
export function inviteLink(code: string): string {
  return `${window.location.origin}/register?invite=${encodeURIComponent(code)}`
}

/** S-15 Invites (admin only, UC-28): list with status, create with note and expiry, copy/share link, revoke. */
export function InvitesSection() {
  const { t } = useTranslation()
  const online = useOnline()
  const queryClient = useQueryClient()
  const snackbar = useSnackbar()
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<InviteSummary | null>(null)
  const [revoking, setRevoking] = useState<string | null>(null)
  const invites = useQuery({
    queryKey: INVITES_KEY,
    queryFn: () => callApi(() => listInvites()),
    enabled: online,
  })
  const revoke = useMutation({
    mutationFn: (code: string) => callApi(() => revokeInvite(code)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: INVITES_KEY }),
    onError: (error) => snackbar.show({ message: errorMessage(apiErrorCode(error)) }),
  })

  return (
    <SettingsGroup title={t('invites.section')}>
      <div className="flex flex-col gap-2 p-4">
        <OfflineHint>
          {(offline) => (
            <Button size="xl" disabled={offline} onClick={() => setCreating(true)}>
              {t('invites.create')}
            </Button>
          )}
        </OfflineHint>
        {invites.isError && (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage(apiErrorCode(invites.error))}
          </p>
        )}
      </div>
      {invites.data?.length === 0 && <p className="px-4 py-3 text-sm text-muted-foreground">{t('invites.empty')}</p>}
      {invites.data && invites.data.length > 0 && (
        <ul aria-label={t('invites.section')} className="flex flex-col divide-y">
          {invites.data.map((invite) => (
            <InviteRow key={invite.code} invite={invite} onRevoke={() => setRevoking(invite.code)} />
          ))}
        </ul>
      )}
      <CreateInviteSheet
        open={creating}
        onOpenChange={setCreating}
        onCreated={(invite) => {
          setCreating(false)
          setCreated(invite)
          void queryClient.invalidateQueries({ queryKey: INVITES_KEY })
        }}
      />
      <InviteLinkSheet invite={created} onClose={() => setCreated(null)} />
      <ConfirmSheet
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={t('invites.revokeConfirm')}
        description={t('invites.revokeHint')}
        confirmLabel={t('invites.revoke')}
        onConfirm={() => revoking && revoke.mutate(revoking)}
      />
    </SettingsGroup>
  )
}

function InviteRow({ invite, onRevoke }: { invite: InviteSummary; onRevoke: () => void }) {
  const { t, i18n } = useTranslation()
  const online = useOnline()
  const detail =
    invite.status === 'used'
      ? t('invites.usedBy', { email: invite.used_by_email ?? '—' })
      : invite.status === 'active'
        ? t('invites.expires', { when: relativeTime(invite.expires_at, i18n.language) })
        : t('invites.expired')
  return (
    <li className="flex min-h-14 items-center gap-3 px-4 py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <span className="font-mono tabular-nums">{invite.code}</span>
          <StatusBadge status={invite.status} />
        </span>
        {invite.note && <span className="truncate">{invite.note}</span>}
        <span className="truncate text-sm text-muted-foreground">{detail}</span>
      </div>
      {invite.status === 'active' && (
        <Button
          variant="outline"
          size="xl"
          disabled={!online}
          aria-label={t('invites.revokeCode', { code: invite.code })}
          onClick={onRevoke}
        >
          {t('invites.revoke')}
        </Button>
      )}
    </li>
  )
}

function StatusBadge({ status }: { status: InviteStatus }) {
  const { t } = useTranslation()
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-xs font-medium',
        status === 'active' && 'bg-primary/10 text-primary',
        status === 'used' && 'bg-muted text-muted-foreground',
        status === 'expired' && 'bg-destructive/10 text-destructive',
      )}
    >
      {t(`invites.status.${status}`)}
    </span>
  )
}

type CreateProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (invite: InviteSummary) => void
}

function CreateInviteSheet({ open, onOpenChange, onCreated }: CreateProps) {
  const { t } = useTranslation()
  const id = useId()
  const [note, setNote] = useState('')
  const [days, setDays] = useState<number>(DEFAULT_DAYS)
  const create = useMutation({
    mutationFn: () => callApi(() => createInvite({ note: note.trim() || null, days })),
    onSuccess: (invite) => {
      setNote('')
      setDays(DEFAULT_DAYS)
      onCreated(invite)
    },
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    create.mutate()
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-w-[480px]">
        <SheetHeader>
          <SheetTitle className="text-lg">{t('invites.create')}</SheetTitle>
          <SheetDescription>{t('invites.createHint')}</SheetDescription>
        </SheetHeader>
        <form className="flex flex-col gap-4 px-4 pb-4" onSubmit={submit}>
          <FormField id={`${id}-note`} label={t('invites.note')}>
            <Input id={`${id}-note`} maxLength={200} value={note} onChange={(event) => setNote(event.target.value)} />
          </FormField>
          <FormField id={`${id}-days`} label={t('invites.expiresIn')}>
            <select
              id={`${id}-days`}
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
              className="h-11 rounded-lg border bg-background px-3"
            >
              {DAY_CHOICES.map((value) => (
                <option key={value} value={value}>
                  {t('invites.days', { count: value })}
                </option>
              ))}
            </select>
          </FormField>
          {create.isError && (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage(apiErrorCode(create.error))}
            </p>
          )}
          <Button type="submit" size="xl" disabled={create.isPending}>
            {t('common.create')}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  )
}

function InviteLinkSheet({ invite, onClose }: { invite: InviteSummary | null; onClose: () => void }) {
  const { t } = useTranslation()
  const snackbar = useSnackbar()
  const link = invite ? inviteLink(invite.code) : ''
  const canShare = typeof navigator.share === 'function'

  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
      snackbar.show({ message: t('invites.copied') })
    } catch {
      snackbar.show({ message: t('invites.copyFailed') })
    }
  }

  async function share() {
    try {
      await navigator.share({ title: t('onboarding.appName'), text: t('invites.shareText'), url: link })
    } catch {
      // Cancelled share sheet.
    }
  }

  return (
    <Sheet open={invite !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" className="mx-auto max-w-[480px]">
        <SheetHeader>
          <SheetTitle className="text-lg">{t('invites.createdTitle')}</SheetTitle>
          <SheetDescription>{t('invites.createdHint')}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-3 px-4 pb-4">
          <output aria-label={t('invites.link')} className="rounded-lg border bg-muted p-3 font-mono text-sm break-all">
            {link}
          </output>
          <Button size="xl" onClick={() => void copy()}>
            <Copy className="size-4" aria-hidden />
            {t('invites.copy')}
          </Button>
          {canShare && (
            <Button size="xl" variant="outline" onClick={() => void share()}>
              <Share className="size-4" aria-hidden />
              {t('invites.share')}
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
