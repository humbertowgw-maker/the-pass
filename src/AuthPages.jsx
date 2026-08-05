import { AccountView, AuthView } from '@neondatabase/neon-js/auth/react'

export function AuthPage({ pathname = 'sign-in' }) {
  return <main className="auth-page"><AuthView path={pathname} /></main>
}

export function AccountPage({ pathname = 'settings' }) {
  return <main className="auth-page"><AccountView path={pathname} /></main>
}
