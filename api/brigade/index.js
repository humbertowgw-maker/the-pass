// Azure Function: the sequential kitchen brigade.
// Head Chef (Groq) -> Sous Chef (OpenAI) -> Critic (Claude).
// API keys live server-side in Azure Static Web App settings.

const GROQ_KEY = process.env.GROQ_API_KEY
const OPENAI_KEY = process.env.OPENAI_API_KEY
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY

const MODELS = {
  head: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  sous: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  critic: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
}

module.exports = async function (context, req) {
  const ingredients = (req.body && req.body.ingredients || '').toString().slice(0, 1000).trim()

  if (!ingredients) {
    context.res = { status: 400, body: 'No ingredients on the ticket.' }
    return
  }

  try {
    const head = await headChef(ingredients)
    const sous = await sousChef(ingredients, head)
    const critic = await theCritic(ingredients, head, sous)

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: { head, sous, critic },
    }
  } catch (err) {
    context.log.error('Brigade failure:', err)
    context.res = { status: 502, body: `A station went down: ${err.message}` }
  }
}

function extractJson(text) {
  if (!text) throw new Error('empty response')
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('no JSON found')
  return JSON.parse(candidate.slice(start, end + 1))
}

async function groq(system, user) {
  requireKey(GROQ_KEY, 'GROQ_API_KEY', 'Head Chef')
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_KEY}` },
    body: JSON.stringify({
      model: MODELS.head,
      temperature: 0.8,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  })
  if (!r.ok) throw await providerError('Head Chef (Groq)', r)
  const d = await r.json()
  return d.choices?.[0]?.message?.content
}

async function openai(system, user) {
  requireKey(OPENAI_KEY, 'OPENAI_API_KEY', 'Sous Chef')
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: MODELS.sous,
      temperature: 0.6,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  })
  if (!r.ok) throw await providerError('Sous Chef (OpenAI)', r)
  const d = await r.json()
  return d.choices?.[0]?.message?.content
}

async function claude(system, user) {
  requireKey(ANTHROPIC_KEY, 'ANTHROPIC_API_KEY', 'The Critic')
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODELS.critic,
      max_tokens: 700,
      temperature: 0.4,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  })
  if (!r.ok) throw await providerError('The Critic (Claude)', r)
  const d = await r.json()
  return (d.content || []).filter((block) => block.type === 'text').map((block) => block.text).join('\n')
}

function requireKey(value, setting, station) {
  if (!value) throw new Error(`${station} is not configured. Add ${setting} to the Azure app settings.`)
}

async function providerError(provider, response) {
  let detail = ''
  try {
    const body = await response.json()
    detail = body.error?.message || body.message || ''
  } catch {
    // Providers do not always return JSON errors.
  }
  return new Error(`${provider} returned ${response.status}${detail ? `: ${detail}` : ''}`)
}

async function headChef(ingredients) {
  const sys = `You are the Head Chef at a Michelin-starred kitchen — bold, decisive, inventive. A ticket lists only what's on hand. Invent ONE achievable dish (basic pantry staples — salt, pepper, oil, water — assumed available). Respond ONLY with JSON, no prose:
{"title": "dish name", "description": "one vivid sentence", "ingredients": ["qty + item", ...], "steps": ["step", ...]}`
  return extractJson(await groq(sys, `On hand: ${ingredients}`))
}

async function sousChef(ingredients, dish) {
  const sys = `You are the Sous Chef — precise, technical, and practical. Check that the proposed dish can actually be cooked with the ingredients on hand. Give 2-4 concise corrections covering technique, seasoning, timing, quantities, food safety, or a smart swap. Never introduce an ingredient that is not on hand except salt, pepper, oil, or water. Respond ONLY with JSON:
{"notes": ["correction", ...]}`
  return extractJson(await openai(sys, `On hand: ${ingredients}\n\nThe dish:\n${JSON.stringify(dish)}`))
}

async function theCritic(ingredients, dish, refinement) {
  const sys = `You are Claude acting as the executive chef at the pass. Audit the proposed recipe and the sous chef's corrections for ingredient fidelity, cookability, clear timing, and food safety. Be honest but useful. Approve the dish only if a home cook can make it from what is on hand. Respond ONLY with JSON:
{"rating": 4, "approved": true, "verdict": "one or two vivid but practical sentences", "final_touches": ["last correction or serving note", ...]}`
  return extractJson(await claude(
    sys,
    `On hand: ${ingredients}\n\nThe dish:\n${JSON.stringify(dish)}\n\nSous chef's corrections:\n${JSON.stringify(refinement)}`,
  ))
}
