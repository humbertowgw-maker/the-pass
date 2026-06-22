// Azure Function: the sequential kitchen brigade.
// Head Chef (Groq) -> Sous Chef (OpenAI) -> Critic (Claude).
// All API keys live here, server-side. The frontend never sees them.

const GROQ_KEY = process.env.GROQ_API_KEY
const OPENAI_KEY = process.env.OPENAI_API_KEY
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY

module.exports = async function (context, req) {
  const ingredients = (req.body && req.body.ingredients || '').toString().slice(0, 1000).trim()

  if (!ingredients) {
    context.res = { status: 400, body: 'No ingredients on the ticket.' }
    return
  }

  try {
    // ---- STATION 1: Head Chef invents the dish (Groq) ----
    const head = await headChef(ingredients)

    // ---- STATION 2: Sous Chef refines it (OpenAI), seeing the dish ----
    const sous = await sousChef(ingredients, head)

    // ---- THE PASS: Critic judges the finished plate (Claude) ----
    const critic = await theCritic(head, sous)

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

// Pulls a JSON object out of a model response even if it's wrapped in prose/fences.
function extractJson(text) {
  if (!text) throw new Error('empty response')
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('no JSON found')
  return JSON.parse(candidate.slice(start, end + 1))
}

async function headChef(ingredients) {
  const sys = `You are the Head Chef at a Michelin-starred kitchen. A ticket comes in listing only what's on hand. Invent ONE achievable dish from those ingredients (basic pantry staples — salt, pepper, oil, water — are assumed available). Respond ONLY with JSON, no prose:
{"title": "dish name", "description": "one vivid sentence", "ingredients": ["qty + item", ...], "steps": ["step", ...]}`
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_KEY}` },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      temperature: 0.8,
      messages: [{ role: 'system', content: sys }, { role: 'user', content: `On hand: ${ingredients}` }],
    }),
  })
  if (!r.ok) throw new Error(`Head Chef (Groq) ${r.status}`)
  const d = await r.json()
  return extractJson(d.choices?.[0]?.message?.content)
}

async function sousChef(ingredients, dish) {
  const sys = `You are the Sous Chef. The Head Chef handed you a dish. Give 2-4 sharp, practical corrections that elevate it — technique, seasoning, timing, or a smart swap using only what's on hand. Respond ONLY with JSON:
{"notes": ["correction", ...]}`
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.7,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: `On hand: ${ingredients}\n\nThe dish:\n${JSON.stringify(dish)}` },
      ],
    }),
  })
  if (!r.ok) throw new Error(`Sous Chef (OpenAI) ${r.status}`)
  const d = await r.json()
  return extractJson(d.choices?.[0]?.message?.content)
}

async function theCritic(dish, refinement) {
  const sys = `You are a feared but fair restaurant critic standing at the pass. Judge the finished plate in ONE or TWO sentences — subjective, evocative, a little theatrical, but honest. Give a star rating 1-5. Respond ONLY with JSON:
{"rating": 4, "verdict": "your verdict"}`
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      system: sys,
      messages: [{ role: 'user', content: `The dish:\n${JSON.stringify(dish)}\n\nSous chef's corrections:\n${JSON.stringify(refinement)}` }],
    }),
  })
  if (!r.ok) throw new Error(`Critic (Claude) ${r.status}`)
  const d = await r.json()
  const text = (d.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n')
  return extractJson(text)
}
