import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { NeonAuthUIProvider } from '@neondatabase/neon-js/auth/react'
import '@neondatabase/neon-js/ui/css'
import './index.css'
import App from './App.jsx'
import { AccountPage, AuthPage } from './AuthPages.jsx'
import { authClient } from './auth.js'

const parts = window.location.pathname.split('/').filter(Boolean)
const page = parts[0] === 'auth'
  ? <AuthPage pathname={parts[1]} />
  : parts[0] === 'account'
    ? <AccountPage pathname={parts[1]} />
    : <App />

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <NeonAuthUIProvider authClient={authClient} redirectTo="/">
      {page}
    </NeonAuthUIProvider>
  </StrictMode>,
)
