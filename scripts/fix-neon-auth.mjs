import { readFile, writeFile } from 'node:fs/promises'

const authUiFile = new URL('../node_modules/@neondatabase/auth-ui/dist/index.mjs', import.meta.url)
const source = await readFile(authUiFile, 'utf8')
const oldImport = 'anonymousClient, apiKeyClient, emailOTPClient'

if (source.includes(oldImport)) {
  const patched = source
    .replace(oldImport, 'anonymousClient, emailOTPClient')
    .replace('from "better-auth/client/plugins";', 'from "better-auth/client/plugins";\nconst apiKeyClient = () => ({ id: "api-key", $InferServerPlugin: {}, pathMethods: {}, $ERROR_CODES: {} });')
  await writeFile(authUiFile, patched)
} else if (!source.includes('const apiKeyClient = ()')) {
  throw new Error('Neon Auth UI compatibility patch no longer matches; update or remove it')
}
