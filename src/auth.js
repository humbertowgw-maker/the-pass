import { createClient } from '@neondatabase/neon-js'
import { BetterAuthReactAdapter } from '@neondatabase/neon-js/auth/react/adapters'

const authUrl = import.meta.env.VITE_NEON_AUTH_URL
  || 'https://ep-raspy-art-af3qfhgo.neonauth.c-2.us-west-2.aws.neon.tech/neondb/auth'
const dataApiUrl = import.meta.env.VITE_NEON_DATA_API_URL
  || 'https://ep-raspy-art-af3qfhgo.apirest.c-2.us-west-2.aws.neon.tech/neondb/rest/v1'

export const neonClient = createClient({
  auth: {
    adapter: BetterAuthReactAdapter(),
    url: authUrl,
    allowAnonymous: true,
  },
  dataApi: {
    url: dataApiUrl,
  },
})

export const authClient = neonClient.auth
