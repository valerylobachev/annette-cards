import { useSearch } from '@tanstack/react-router'
import { AuthPage } from './AuthPage'

export function SignInPage() {
  const { invite } = useSearch({ from: '/signin' })
  return <AuthPage mode="signin" invite={invite} />
}

export function RegisterPage() {
  const { invite } = useSearch({ from: '/register' })
  return <AuthPage mode="register" invite={invite} />
}
