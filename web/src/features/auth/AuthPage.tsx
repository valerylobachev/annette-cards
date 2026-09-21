import { useNavigate, useRouter } from '@tanstack/react-router'
import { ChevronLeft, Eye, EyeOff } from 'lucide-react'
import { type FormEvent, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { login, register } from '@/api/endpoints/auth/auth'
import type { MeResponse } from '@/api/model'
import { FormField } from '@/components/FormField'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { apiErrorCode, callApi } from '@/lib/api'
import { errorMessage } from '@/lib/apiErrors'
import { useOnline } from '@/lib/useOnline'
import { Segmented } from '../settings/SettingsList'
import { beginFirstSync } from '../sync/firstSync'

export type AuthMode = 'signin' | 'register'

const MIN_PASSWORD_LENGTH = 10

/** A readable label of this device for the list of sessions, e.g. "iPhone" or "Macintosh". */
function deviceLabel(): string {
  return /iPhone|iPad|Android|Macintosh|Windows|Linux/.exec(navigator.userAgent)?.[0] ?? 'Browser'
}

type Props = { mode: AuthMode; invite?: string }

/** S-02 Sign in / Register (UC-02, UC-03): a segmented control switches between the two forms (and routes). */
export function AuthPage({ mode, invite }: Props) {
  const { t } = useTranslation()
  const router = useRouter()
  const navigate = useNavigate()
  const online = useOnline()

  /** The account is stored once the first sync is settled (S-03). */
  async function done(me: MeResponse) {
    await beginFirstSync(me)
    await navigate({ to: '/first-sync', replace: true })
  }

  return (
    <div className="mx-auto flex w-full max-w-[480px] flex-col gap-6 px-4 pt-4 pb-8">
      <header className="flex min-h-11 items-center gap-2">
        <Button variant="ghost" size="icon-xl" aria-label={t('common.back')} onClick={() => router.history.back()}>
          <ChevronLeft className="size-6" />
        </Button>
        <h1 className="text-2xl font-semibold">
          {t(mode === 'signin' ? 'screens.signIn.title' : 'screens.register.title')}
        </h1>
      </header>
      <Segmented<AuthMode>
        label={t('auth.mode')}
        value={mode}
        options={[
          { value: 'signin', label: t('auth.signIn') },
          { value: 'register', label: t('auth.register') },
        ]}
        onChange={(next) =>
          navigate({ to: next === 'signin' ? '/signin' : '/register', search: { invite }, replace: true })
        }
      />
      {!online && (
        <p role="status" className="rounded-xl border bg-muted p-3 text-sm">
          {t('auth.offline')}
        </p>
      )}
      {mode === 'signin' ? (
        <SignInForm disabled={!online} onDone={done} />
      ) : (
        <RegisterForm disabled={!online} invite={invite} onDone={done} />
      )}
    </div>
  )
}

type FormProps = { disabled: boolean; onDone: (me: MeResponse) => Promise<void> }

function useSubmit(onDone: FormProps['onDone']) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(request: () => Promise<MeResponse>) {
    setBusy(true)
    setError(null)
    try {
      await onDone(await request())
    } catch (caught) {
      setError(apiErrorCode(caught))
    } finally {
      setBusy(false)
    }
  }

  return { busy, error, submit }
}

function SignInForm({ disabled, onDone }: FormProps) {
  const { t } = useTranslation()
  const id = useId()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const { busy, error, submit } = useSubmit(onDone)

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    void submit(() => callApi(() => login({ email, password, device_label: deviceLabel() })))
  }

  return (
    <form className="flex flex-col gap-4" aria-label={t('auth.signIn')} onSubmit={onSubmit} noValidate>
      <fieldset disabled={disabled || busy} className="flex min-w-0 flex-col gap-4">
        <FormField id={`${id}-email`} label={t('auth.email')}>
          <Input
            id={`${id}-email`}
            type="email"
            autoComplete="username"
            inputMode="email"
            autoCapitalize="none"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </FormField>
        <PasswordField
          id={`${id}-password`}
          label={t('auth.password')}
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
        />
        <FormError code={error} />
        <Button type="submit" size="xl" disabled={email.trim() === '' || password === ''}>
          {t('auth.signInAction')}
        </Button>
      </fieldset>
    </form>
  )
}

function RegisterForm({ disabled, invite, onDone }: FormProps & { invite?: string }) {
  const { t } = useTranslation()
  const id = useId()
  const [code, setCode] = useState(invite ?? '')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const { busy, error, submit } = useSubmit(onDone)
  const longEnough = [...password].length >= MIN_PASSWORD_LENGTH
  const complete = code.trim() !== '' && name.trim() !== '' && email.trim() !== '' && longEnough

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    const body = { invite_code: code, display_name: name, email, password, device_label: deviceLabel() }
    void submit(() => callApi(() => register(body)))
  }

  return (
    <form className="flex flex-col gap-4" aria-label={t('auth.register')} onSubmit={onSubmit} noValidate>
      <fieldset disabled={disabled || busy} className="flex min-w-0 flex-col gap-4">
        <FormField id={`${id}-invite`} label={t('auth.inviteCode')}>
          <Input
            id={`${id}-invite`}
            autoCapitalize="characters"
            autoComplete="off"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </FormField>
        <FormField id={`${id}-name`} label={t('auth.displayName')}>
          <Input
            id={`${id}-name`}
            autoComplete="nickname"
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>
        <FormField id={`${id}-email`} label={t('auth.email')}>
          <Input
            id={`${id}-email`}
            type="email"
            autoComplete="username"
            inputMode="email"
            autoCapitalize="none"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </FormField>
        <PasswordField
          id={`${id}-password`}
          label={t('auth.password')}
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
          hint={t(longEnough ? 'auth.passwordOk' : 'auth.passwordHint', { min: MIN_PASSWORD_LENGTH })}
        />
        <FormError code={error} />
        <Button type="submit" size="xl" disabled={!complete}>
          {t('auth.createAccount')}
        </Button>
      </fieldset>
    </form>
  )
}

type PasswordFieldProps = {
  id: string
  label: string
  autoComplete: string
  value: string
  onChange: (value: string) => void
  hint?: string
}

function PasswordField({ id, label, autoComplete, value, onChange, hint }: PasswordFieldProps) {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)
  return (
    <FormField id={id} label={label} hint={hint}>
      <div className="relative">
        <Input
          id={id}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          autoCapitalize="none"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="pr-12"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-xl"
          className="absolute top-0 right-0"
          aria-label={t(visible ? 'auth.hidePassword' : 'auth.showPassword')}
          aria-pressed={visible}
          onClick={() => setVisible((shown) => !shown)}
        >
          {visible ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
        </Button>
      </div>
    </FormField>
  )
}

function FormError({ code }: { code: string | null }) {
  if (!code) return null
  return (
    <p role="alert" className="text-sm text-destructive">
      {errorMessage(code)}
    </p>
  )
}
