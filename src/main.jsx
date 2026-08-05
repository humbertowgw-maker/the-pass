import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { NeonAuthUIProvider } from '@neondatabase/neon-js/auth/react'
import '@neondatabase/neon-js/ui/css'
import './index.css'
import App from './App.jsx'
import { AccountPage, AuthPage } from './AuthPages.jsx'
import { authClient } from './auth.js'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <NeonAuthUIProvider authClient={authClient} redirectTo="/">
      <PathRouter />
    </NeonAuthUIProvider>
  </StrictMode>,
)

function PathRouter() {
  const parts = window.location.pathname.split('/').filter(Boolean)
  if (parts[0] === 'auth') return <AuthPage pathname={parts[1]} />
  if (parts[0] === 'account') return <AccountPage pathname={parts[1]} />
  return <App />
}
