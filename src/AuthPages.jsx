import { useParams } from 'react-router'
import { AccountView, AuthView } from '@neondatabase/neon-js/auth/react'

export function AuthPage() {
  const { pathname = 'sign-in' } = useParams()
  return <main className="auth-page"><AuthView path={pathname} /></main>
}

export function AccountPage() {
  const { pathname = 'settings' } = useParams()
  return <main className="auth-page"><AccountView path={pathname} /></main>
}
