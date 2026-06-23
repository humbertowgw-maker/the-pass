# The Pass — AI Kitchen Brigade

Tell the kitchen what's in your fridge. Three AI models work the line in sequence:

- **Head Chef** (Groq / llama-3.3-70b) invents a dish from your ingredients
- **Sous Chef** (OpenAI / gpt-4o-mini) refines it with practical corrections
- **Claude at the Pass** (Anthropic / Sonnet 4.6) audits ingredient fidelity,
  cookability, food safety, and decides whether the dish is ready to serve

Built with Vite + React. Deployed to **Azure Static Web Apps** with the AI
calls running in an **Azure Function** (`/api/brigade`) so API keys stay
server-side and never reach the browser.

## Architecture

```
Browser (React)  ──POST /api/brigade──►  Azure Function
                                          ├─► Groq      (Head Chef)
                                          ├─► OpenAI    (Sous Chef)
                                          └─► Anthropic (Critic)
```

Sequential by design: each station sees the previous station's work, so the
panel behaves like a real kitchen brigade rather than three isolated calls.

## Environment variables (set in Azure SWA → Configuration)

- `GROQ_API_KEY`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`

Optional model overrides:

- `GROQ_MODEL`
- `OPENAI_MODEL`
- `ANTHROPIC_MODEL`

## Local dev

```
npm install
npm run dev          # frontend on :5173, proxies /api to :7071
# in another terminal, run the function host:
cd api && func start # requires Azure Functions Core Tools
```
