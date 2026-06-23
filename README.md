# The Pass — AI Kitchen Brigade

Tell the kitchen what's in your fridge. Every ticket now produces four
deliberately different recipes, and three AI models work the line in sequence:

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

## Product behavior

- Four distinct dishes are returned for every ingredient ticket.
- Recipe titles and descriptions are remembered in `sessionStorage`, so
  another round avoids both exact repeats and close variations during that
  browser session.
- Saved recipes and tasting-room reviews are stored on the current device.
- Reviews can include a plate photo, rating, quote, and the full recipe needed
  to recreate the dish.
- Highly rated recipes appear in the cookbook watchlist.

Shared community accounts, cloud photo storage, moderation, rights consent,
and cookbook publishing require a persistent database and storage service.
Amazon KDP publishing should remain an approval-gated release step; automated
proof copies and direct fulfillment can later use a print API such as Lulu.

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
