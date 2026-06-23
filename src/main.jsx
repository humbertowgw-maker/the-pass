import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { NeonAuthUIProvider } from '@neondatabase/neon-js/auth/react'
import '@neondatabase/neon-js/ui/css'
import './index.css'
import App from './App.jsx'
import { AccountPage, AuthPage } from './AuthPages.jsx'
import { authClient } from './auth.js'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <NeonAuthUIProvider authClient={authClient} redirectTo="/">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/auth/:pathname" element={<AuthPage />} />
          <Route path="/account/:pathname" element={<AccountPage />} />
        </Routes>
      </BrowserRouter>
    </NeonAuthUIProvider>
  </StrictMode>,
)
