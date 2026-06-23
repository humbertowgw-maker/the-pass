// Azure Function: Head Chef creates the plates, then Sous Chef and Critic review in parallel.
// API keys live server-side in Azure Static Web App settings.

const GROQ_KEY = process.env.GROQ_API_KEY
const OPENAI_KEY = process.env.OPENAI_API_KEY
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY

const MODELS = {
  head: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  sous: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  critic: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
}

const PROVIDER_TIMEOUT_MS = Number(process.env.PROVIDER_TIMEOUT_MS || 20000)

module.exports = async function (context, req) {
  if (req.method && req.method.toUpperCase() !== 'POST') {
    context.res = { status: 405, body: 'The kitchen only accepts POST tickets.' }
    return
  }

  const ingredients = (req.body && req.body.ingredients || '').toString().slice(0, 1000).trim()
  const preferences = {
    cuisine: cleanPreference(req.body?.preferences?.cuisine, 'surprise me'),
    mood: cleanPreference(req.body?.preferences?.mood, 'anything'),
    meal: cleanPreference(req.body?.preferences?.meal, 'any meal'),
    servings: cleanPreference(req.body?.preferences?.servings, 'auto'),
  }
  const previousTitles = Array.isArray(req.body?.previousTitles)
    ? req.body.previousTitles.map((title) => String(title).slice(0, 120)).slice(-30)
    : []
  const previousRecipes = Array.isArray(req.body?.previousRecipes)
    ? req.body.previousRecipes.slice(-30).map((recipe) => ({
        title: String(recipe?.title || '').slice(0, 120),
        description: String(recipe?.description || '').slice(0, 240),
      }))
    : previousTitles.map((title) => ({ title, description: '' }))

  if (!ingredients) {
    context.res = { status: 400, body: 'No ingredients on the ticket.' }
    return
  }

  try {
    const dishes = await headChef(ingredients, previousRecipes, preferences)
    const [refinements, verdicts] = await Promise.all([
      sousChef(ingredients, dishes, preferences),
      theCritic(ingredients, dishes, preferences),
    ])
    const recipes = dishes.map((head, index) => ({
      id: recipeId(head.title, index),
      head,
      sous: refinements[index] || { notes: [] },
      critic: verdicts[index] || {
        rating: 0,
        approved: false,
        verdict: 'This plate still needs review.',
        final_touches: [],
      },
    }))

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: { recipes },
    }
  } catch (err) {
    context.log.error('Brigade failure:', err)
    context.res = { status: 502, body: `A station went down: ${err.message}` }
  }
}

function cleanPreference(value, fallback) {
  const cleaned = String(value || '').trim().slice(0, 60)
  return cleaned || fallback
}

function recipeId(title, index) {
  const slug = String(title || `recipe-${index + 1}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
  return `${Date.now()}-${index + 1}-${slug}`
}

function extractJson(text, station) {
  if (!text) throw new Error(`${station} returned an empty response`)
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`${station} returned no JSON`)
  }

  const json = candidate.slice(start, end + 1)
  try {
    return JSON.parse(json)
  } catch {
    try {
      return JSON.parse(repairModelJson(json))
    } catch (repairError) {
      throw new Error(`${station} returned invalid JSON`, {
        cause: repairError,
      })
    }
  }
}

function repairModelJson(json) {
  const withoutTrailingCommas = json.replace(/,\s*([}\]])/g, '$1')
  const repaired = []
  const stack = []
  let inString = false
  let escaped = false

  for (const char of withoutTrailingCommas) {
    if (inString) {
      repaired.push(char)
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }

    if (char === '"') {
      inString = true
      repaired.push(char)
      continue
    }

    if (char === '{' || char === '[') {
      stack.push(char)
      repaired.push(char)
      continue
    }

    if (char === '}' || char === ']') {
      const opener = char === '}' ? '{' : '['
      if (!stack.includes(opener)) continue
      while (stack.at(-1) !== opener) {
        repaired.push(stack.pop() === '{' ? '}' : ']')
      }
      stack.pop()
    }

    repaired.push(char)
  }

  while (stack.length) repaired.push(stack.pop() === '{' ? '}' : ']')
  return repaired.join('')
}

async function groq(system, user) {
  requireKey(GROQ_KEY, 'GROQ_API_KEY', 'Head Chef')
  const r = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_KEY}` },
    body: JSON.stringify({
      model: MODELS.head,
      temperature: 0.8,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  }, 'Head Chef (Groq)')
  if (!r.ok) throw await providerError('Head Chef (Groq)', r)
  const d = await r.json()
  return d.choices?.[0]?.message?.content
}

async function openai(system, user) {
  requireKey(OPENAI_KEY, 'OPENAI_API_KEY', 'Sous Chef')
  const r = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: MODELS.sous,
      temperature: 0.6,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  }, 'Sous Chef (OpenAI)')
  if (!r.ok) throw await providerError('Sous Chef (OpenAI)', r)
  const d = await r.json()
  return d.choices?.[0]?.message?.content
}

async function claude(system, user) {
  requireKey(ANTHROPIC_KEY, 'ANTHROPIC_API_KEY', 'The Critic')
  const r = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODELS.critic,
      max_tokens: 2200,
      temperature: 0.4,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  }, 'The Critic (Claude)')
  if (!r.ok) throw await providerError('The Critic (Claude)', r)
  const d = await r.json()
  return (d.content || []).filter((block) => block.type === 'text').map((block) => block.text).join('\n')
}

function requireKey(value, setting, station) {
  if (!value) throw new Error(`${station} is not configured. Add ${setting} to the Azure app settings.`)
}

async function fetchWithTimeout(url, options, station) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error(`${station} timed out. Try again in a minute.`, { cause: err })
    }
    throw err
  } finally {
    clearTimeout(timeout)
  }
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

async function headChef(ingredients, previousRecipes, preferences) {
  const sys = `You are the Head Chef at a Michelin-starred kitchen — bold, decisive, inventive. A ticket lists only what's on hand. Invent EXACTLY FOUR genuinely different, achievable dishes. Within this round, each dish must use a different physical format and primary technique: for example a handheld, composed plate, skillet dish, soup, bake, crisp, salad, or sauce-based dish. Four small variations of eggs, potato cakes, wraps, or any other single idea are not acceptable. Basic pantry staples — salt, pepper, oil, and water — are assumed available.

The prior-session list is a BANNED CONCEPT list, not merely banned titles. If it contains a potato cake, do not make another cake, patty, rösti, hash brown, fritter, or renamed version of that concept. Apply the same semantic rule to every prior dish. Choose four concepts whose core cooking method and eating experience are absent from the banned list. Respond ONLY with JSON, no prose:
{"recipes": [{"title": "dish name", "description": "one vivid sentence", "cuisine": "best-fit cuisine", "mood": "comforting|light|quick|adventurous|indulgent|healthy", "servings": 2, "serving_note": "honest quantity note", "ingredients": ["qty + item", ...], "steps": ["clear step with timing", ...]}]}

Quantity is a hard constraint. Never claim more servings than the listed food can realistically produce. If servings is "auto", infer a conservative whole-number yield from the quantities given. If the requested serving count is impossible, scale down to the honest yield and say so in serving_note. One ordinary box of pasta is generally 4 main-dish servings, not a feast. Honor cuisine, mood, and meal preferences when the ingredients make them plausible; otherwise choose the closest honest fit without inventing specialty ingredients.`
  const result = extractJson(await groq(
    sys,
    `On hand: ${ingredients}\n\nPreferences: ${JSON.stringify(preferences)}\n\nBanned prior concepts:\n${previousRecipes.length ? JSON.stringify(previousRecipes) : 'none'}`,
  ), 'Head Chef')
  if (!Array.isArray(result.recipes) || result.recipes.length < 4) {
    throw new Error('Head Chef did not return four complete dishes')
  }
  return result.recipes.slice(0, 4)
}

async function sousChef(ingredients, dishes, preferences) {
  const sys = `You are the Sous Chef — precise, technical, and practical. Review all four proposed dishes. For each one, give 2-4 concise corrections covering technique, seasoning, timing, quantities, food safety, or a smart swap. Never introduce an ingredient that is not on hand except salt, pepper, oil, or water. Preserve the exact recipe order. Respond ONLY with JSON:
{"reviews": [{"title": "matching dish title", "notes": ["correction", ...]}]}`
  const result = extractJson(await openai(
    sys,
    `On hand: ${ingredients}\n\nRequested preferences: ${JSON.stringify(preferences)}\n\nThe four dishes:\n${JSON.stringify(dishes)}`,
  ), 'Sous Chef')
  return Array.isArray(result.reviews) ? result.reviews.slice(0, 4) : []
}

async function theCritic(ingredients, dishes, preferences) {
  const sys = `You are Claude acting as the executive chef at the pass. Independently audit all four proposed recipes for ingredient fidelity, cookability, honest serving yield, preference fit, clear timing, and food safety. Be honest but useful. Approve a dish only if a home cook can make it from what is on hand. Hold any dish that exaggerates its servings or invents unavailable ingredients. Give each dish its own rating and preserve the exact recipe order. Respond ONLY with JSON:
{"reviews": [{"title": "matching dish title", "rating": 4, "approved": true, "verdict": "one or two vivid but practical sentences", "final_touches": ["last correction or serving note", ...]}]}`
  const result = extractJson(await claude(
    sys,
    `On hand: ${ingredients}\n\nRequested preferences: ${JSON.stringify(preferences)}\n\nThe four dishes:\n${JSON.stringify(dishes)}`,
  ), 'The Critic')
  return Array.isArray(result.reviews) ? result.reviews.slice(0, 4) : []
}
