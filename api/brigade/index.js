// Azure Function: the sequential kitchen brigade.
// All three stations run on Groq (free), each with a different model + persona
// so the panel still behaves like three distinct chefs working the line.
// Only one API key needed: GROQ_API_KEY.

const GROQ_KEY = process.env.GROQ_API_KEY

// Three different Groq models so each chef has a genuinely different "voice."
const MODELS = {
  head:   'llama-3.3-70b-versatile',
  sous:   'llama-3.1-8b-instant',
  critic: 'llama-3.3-70b-versatile',
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

function extractJson(text) {
  if (!text) throw new Error('empty response')
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('no JSON found')
  return JSON.parse(candidate.slice(start, end + 1))
}

async function groq(model, system, user) {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_KEY}` },
    body: JSON.stringify({
      model,
      temperature: 0.8,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  })
  if (!r.ok) throw new Error(`Groq ${r.status}`)
  const d = await r.json()
  return d.choices?.[0]?.message?.content
}

async function headChef(ingredients) {
  const sys = `You are the Head Chef at a Michelin-starred kitchen — bold, decisive, inventive. A ticket lists only what's on hand. Invent ONE achievable dish (basic pantry staples — salt, pepper, oil, water — assumed available). Respond ONLY with JSON, no prose:
{"title": "dish name", "description": "one vivid sentence", "ingredients": ["qty + item", ...], "steps": ["step", ...]}`
  return extractJson(await groq(MODELS.head, sys, `On hand: ${ingredients}`))
}

async function sousChef(ingredients, dish) {
  const sys = `You are the Sous Chef — precise, technical, the one who catches mistakes. The Head Chef handed you a dish. Give 2-4 sharp, practical corrections that elevate it (technique, seasoning, timing, or a smart swap using only what's on hand). Respond ONLY with JSON:
{"notes": ["correction", ...]}`
  return extractJson(await groq(MODELS.sous, sys, `On hand: ${ingredients}\n\nThe dish:\n${JSON.stringify(dish)}`))
}

async function theCritic(dish, refinement) {
  const sys = `You are a feared but fair restaurant critic standing at the pass — theatrical, evocative, honest. Judge the finished plate in ONE or TWO sentences and give a star rating 1-5. Respond ONLY with JSON:
{"rating": 4, "verdict": "your verdict"}`
  return extractJson(await groq(MODELS.critic, sys, `The dish:\n${JSON.stringify(dish)}\n\nSous chef's corrections:\n${JSON.stringify(refinement)}`))
}
