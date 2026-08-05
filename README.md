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
- The brigade tip jar opens from `?tip=brigade` and can route to a hosted
  checkout link that supports Apple Pay, Google Pay, cards, and contactless
  wallet options.
- Saved recipes and tasting-room reviews are stored on the current device.
- Reviews can include a plate photo, rating, quote, and the full recipe needed
  to recreate the dish.
- Highly rated recipes appear in the cookbook watchlist.

Shared community accounts, cloud photo storage, moderation, rights consent,
and cookbook publishing require a persistent database and storage service.
Amazon KDP publishing should remain an approval-gated release step; automated
proof copies and direct fulfillment can later use a print API such as Lulu.

## Public community setup

The community backend is Neon:

1. Enable Neon Auth and trust the deployed Pass domain.
2. Run [`neon/schema.sql`](neon/schema.sql) in the production branch SQL editor.
3. Set `VITE_NEON_AUTH_URL` at build time (the app also has the project's public
   Auth URL as a deployment-safe fallback).
4. Enable the Neon Data API before replacing device-local saves and reviews
   with shared cloud records.

Guests should always be able to generate recipes without signing in. Accounts
are only required for cloud saves, preferences, reviews, photos, and cookbook
publishing consent.

## Environment variables (set in Azure SWA → Configuration)

- `GROQ_API_KEY`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`

Optional model overrides:

- `GROQ_MODEL`
- `OPENAI_MODEL`
- `ANTHROPIC_MODEL`

Optional tip checkout:

- `VITE_BRIGADE_TIP_URL` — hosted Stripe Checkout or Payment Link URL with
  Apple Pay, Google Pay, cards, and supported wallet methods enabled in the
  payment processor dashboard.

## Local dev

```
npm install
npm run dev          # frontend on :5173, proxies /api to :7071
# in another terminal, run the function host:
cd api && func start # requires Azure Functions Core Tools
```

## Engineering notes

Notes for anyone reading the code rather than the pitch — real decisions and
fixes visible in the commit history, not a changelog.

- **Sequential orchestration became parallel once it hit a platform
  timeout.** The brigade originally ran Head Chef → Sous Chef → Critic
  strictly in series. Three chained LLM calls started running into Azure
  Functions' request timeout, so `fb18c97` restructured it: Head Chef still
  runs first (Sous Chef and Critic both need its dishes), but Sous Chef and
  Critic now run concurrently via `Promise.all`, and the per-provider
  timeout dropped from 45s to 20s to fit the budget. Same three-model
  pipeline, different shape once the actual latency was measured.

- **Model output is treated as untrusted text, not JSON.** All three
  providers are asked for JSON and none of them reliably deliver it.
  `extractJson()` strips markdown fences, then falls back to
  `repairModelJson()` — a hand-rolled, character-by-character bracket and
  quote balancer that closes unterminated strings/arrays/objects and drops
  trailing commas. This started as a dependency on the `jsonrepair` npm
  package (`b230d27`) and was replaced three minutes later with ~40 lines of
  vendored logic (`81aeec5`, "Keep brigade JSON repair self contained") —
  a deliberate call to not carry a third-party parser inside a server-side
  function that's already handling unpredictable upstream text.

- **A real production bug, fixed days before this repo was cleaned up for
  review.** Azure Functions delivers `req.body` inconsistently — sometimes
  a parsed object, sometimes a raw JSON string, depending on runtime and
  content-type. `71b2ec9` ("fix: parse Azure request body and restore
  deploy workflow") added a `parseBody()` normalizer for both shapes after
  requests were failing against the deployed function.

- **A self-modifying CI loop to clear a dependency CVE, cleaned up after
  itself.** `react-router-dom` needed patching; a temporary workflow
  (`repair-dependencies.yml`) was added purely to run `npm audit`, apply
  lockfile fixes, and push the result back to `main` — iterated several
  times over about fifteen minutes while the pinned version was corrected —
  then deleted once the lockfile audited clean (`4fe546f`, "Remove
  temporary dependency repair workflow"). What's left running on every push
  is `security.yml`: `npm audit --audit-level=high`, `eslint`, `vite build`,
  and a syntax check on the Azure Function.

- **An unmerged branch worth naming honestly.** A separate branch,
  `agent/app-experience`, takes a different approach to the same
  vulnerability: it removes `react-router-dom` entirely in favor of
  hand-rolled native routing (`53f3fd4` onward) instead of patching the
  version. That branch never merged into `main` — production still ships
  with `react-router-dom`. It's mentioned here because it's the same
  problem solved two ways, not because it's deployed.

- **Test coverage for the brigade function.** `api/brigade/index.test.js`
  uses Node's built-in `node:test` runner, not `playwright` — this is
  server-side orchestration and string parsing with `fetch` mocked out, not
  a browser flow, so a browser E2E tool was the wrong fit despite already
  being installed. Coverage includes: the hand-rolled JSON-repair parser
  (`b230d27`/`81aeec5`) against realistic truncated/malformed model output,
  not just trivially-broken JSON; a regression test for the Azure
  `req.body` string-vs-object inconsistency (`71b2ec9`) — plus a related gap
  it caught, a bare non-object JSON body (`null`, a number, an array) that
  crashed the handler outside its try/catch, now normalized and covered;
  and the Groq-then-parallel-OpenAI/Anthropic orchestration itself,
  including a timing assertion that the two parallel calls actually
  overlap. `npm test` runs it; CI (`security.yml`) runs it on every push.
  `playwright` remains installed but unused — real end-to-end browser
  coverage of the recipe flow is still done by hand.
