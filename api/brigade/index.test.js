'use strict'

// Unit + orchestration tests for the brigade Azure Function.
//
// Framework choice: Node's built-in test runner (`node:test`), not
// Playwright. Playwright is a browser E2E tool; this file exercises a
// CommonJS Azure Function handler and a couple of pure string-parsing
// helpers, entirely server-side, with `fetch` mocked out. There is no DOM
// and nothing to drive a browser through. `node:test` needs zero new
// dependencies, matches the Node 22 runtime this repo's CI already pins,
// and is a better fit than pulling in a browser automation stack (or a
// separate unit-test dependency) for logic this shape.
//
// The provider API keys below must be set *before* requiring index.js: the
// module reads them into module-level consts exactly once, at require time.
process.env.GROQ_API_KEY = process.env.GROQ_API_KEY || 'test-groq-key'
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-openai-key'
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-anthropic-key'

const test = require('node:test')
const assert = require('node:assert/strict')

const brigade = require('./index.js')
const { parseBody, extractJson, repairModelJson } = brigade.__testables

// ---------------------------------------------------------------------------
// parseBody: Azure delivers req.body as a parsed object over some paths and
// as a raw JSON string over others (fixed in 71b2ec9, "fix: parse Azure
// request body and restore deploy workflow"). Guard against that class of
// bug recurring.
// ---------------------------------------------------------------------------

test('parseBody: accepts an already-parsed object body', () => {
  const req = { body: { ingredients: 'eggs, rice' } }
  assert.deepEqual(parseBody(req), { ingredients: 'eggs, rice' })
})

test('parseBody: accepts a raw JSON string body (the Azure inconsistency)', () => {
  const req = { body: JSON.stringify({ ingredients: 'eggs, rice' }) }
  assert.deepEqual(parseBody(req), { ingredients: 'eggs, rice' })
})

test('parseBody: object and string forms of the same payload normalize identically', () => {
  const payload = { ingredients: 'eggs, rice', preferences: { cuisine: 'thai' } }
  const fromObject = parseBody({ body: payload })
  const fromString = parseBody({ body: JSON.stringify(payload) })
  assert.deepEqual(fromObject, fromString)
})

test('parseBody: falls back to rawBody when body is undefined', () => {
  const req = { rawBody: JSON.stringify({ ingredients: 'eggs' }) }
  assert.deepEqual(parseBody(req), { ingredients: 'eggs' })
})

test('parseBody: empty string body normalizes to {}', () => {
  assert.deepEqual(parseBody({ body: '' }), {})
  assert.deepEqual(parseBody({ body: '   ' }), {})
})

test('parseBody: malformed string body normalizes to {} instead of throwing', () => {
  assert.deepEqual(parseBody({ body: '{not json' }), {})
})

test('parseBody: missing body and rawBody normalizes to {}', () => {
  assert.deepEqual(parseBody({}), {})
})

test('parseBody: a JSON string body that parses to a non-object value normalizes to {} instead of crashing downstream reads', () => {
  // A syntactically valid JSON body that isn't an object (Content-Type:
  // application/json with a bare `null`, number, string, or array as the
  // top-level value) previously flowed straight through as the "parsed"
  // body. Downstream code reads `body.ingredients` unconditionally, so
  // `null` or an array crashed with an uncaught TypeError *outside* the
  // handler's try/catch, before the 400/502 paths could even engage. This
  // is the same bug class as 71b2ec9 (Azure body shape inconsistency), just
  // a value shape the original fix didn't anticipate.
  assert.deepEqual(parseBody({ body: 'null' }), {})
  assert.deepEqual(parseBody({ body: '42' }), {})
  assert.deepEqual(parseBody({ body: '"just a string"' }), {})
  assert.deepEqual(parseBody({ body: '[1,2,3]' }), {})
})

test('parseBody: an already-parsed non-object body (object form of the same bug) normalizes to {}', () => {
  assert.deepEqual(parseBody({ body: null }), {})
  assert.deepEqual(parseBody({ body: [1, 2, 3] }), {})
})

test('handler: regression — a bare JSON null body does not crash the handler, it returns 400', async () => {
  const context = makeContext()
  await brigade(context, baseReq({ body: 'null' }))
  assert.equal(context.res.status, 400)
})

// ---------------------------------------------------------------------------
// extractJson / repairModelJson: the hand-rolled repair parser added in
// b230d27 / 81aeec5 specifically so no third-party JSON parser touches raw,
// untrusted LLM output. Exercised here against the ways a real model
// response actually comes back malformed (truncation from hitting a token
// limit, markdown fences, trailing commas) rather than only toy inputs.
// ---------------------------------------------------------------------------

test('extractJson: parses clean JSON with no repair needed', () => {
  const text = '{"recipes":[{"title":"Skillet Eggs"}]}'
  assert.deepEqual(extractJson(text, 'Head Chef'), { recipes: [{ title: 'Skillet Eggs' }] })
})

test('extractJson: strips a trailing comma before a closing bracket', () => {
  const text = '{"recipes":[{"title":"a"},{"title":"b"},]}'
  assert.deepEqual(extractJson(text, 'Head Chef'), { recipes: [{ title: 'a' }, { title: 'b' }] })
})

test('extractJson: unwraps a markdown code fence with prose before and after it', () => {
  const text = [
    'Sure, here are the dishes you asked for:',
    '```json',
    '{"recipes":[{"title":"Garlic Soup"}]}',
    '```',
    'Let me know if you would like anything else!',
  ].join('\n')
  assert.deepEqual(extractJson(text, 'Head Chef'), { recipes: [{ title: 'Garlic Soup' }] })
})

test('extractJson: recovers a response truncated mid-recipe by dropping the incomplete trailing item', () => {
  // Simulates hitting max_tokens partway through generating the second
  // recipe: the first dish is a complete, well-formed object; the second
  // is cut off with no closing brace at all.
  const text =
    '{"recipes": [{"title": "Skillet Eggs", "description": "fast", ' +
    '"ingredients": ["egg","salt"], "steps": ["cook"]}, {"title": "Soup'
  const result = extractJson(text, 'Head Chef')
  assert.equal(result.recipes.length, 1)
  assert.equal(result.recipes[0].title, 'Skillet Eggs')
})

test('extractJson: auto-closes multiple levels of unclosed nested structure', () => {
  const text = '{"recipes":[{"title":"a","details":{"steps":["mix","bake"]}'
  const result = extractJson(text, 'Head Chef')
  assert.deepEqual(result, { recipes: [{ title: 'a', details: { steps: ['mix', 'bake'] } }] })
})

test('extractJson: ignores a stray unmatched closing brace', () => {
  const text = '{"recipes":[{"title":"a"}]}}'
  assert.deepEqual(extractJson(text, 'Head Chef'), { recipes: [{ title: 'a' }] })
})

test('extractJson: ignores a stray unmatched closing bracket', () => {
  const text = '{"recipes":[{"title":"a"}]]}'
  assert.deepEqual(extractJson(text, 'Head Chef'), { recipes: [{ title: 'a' }] })
})

test('extractJson: throws a clear "no JSON" error when truncation leaves no closing brace anywhere', () => {
  // A real gap: if generation is cut off before a single "}" has been
  // emitted (e.g. truncated mid-string, "..a fast and tasty dish with a
  // lot of flavor that comes"), the start/end brace scan that runs before
  // repair even begins has nothing to bound, so it fails fast instead of
  // reaching the repair step. This locks in that current, documented
  // behavior so a future change to the scan doesn't silently alter it.
  const text = '{"recipes": [{"title": "Skillet Eggs", "description": "A fast and tasty dish with a lot of flavor'
  assert.throws(() => extractJson(text, 'Head Chef'), /Head Chef returned no JSON/)
})

test('extractJson: throws when the response is empty', () => {
  assert.throws(() => extractJson('', 'Head Chef'), /Head Chef returned an empty response/)
  assert.throws(() => extractJson(null, 'Head Chef'), /Head Chef returned an empty response/)
})

test('extractJson: throws when there is no JSON object in the text at all', () => {
  assert.throws(() => extractJson('I cannot help with that request.', 'Head Chef'), /Head Chef returned no JSON/)
})

test('extractJson: a bracket-balanced but invalid JSON escape (e.g. \\\') is not repaired and throws', () => {
  // Trailing-comma and bracket-balancing repairs don't touch invalid
  // escape sequences. A model that emits `\'` (a common, invalid escape
  // for an apostrophe) still fails after repair — documenting this as a
  // known gap in the parser rather than a silently-passing case.
  const text = '{"recipes":[{"title":"Grandma\\\'s Stew"}]}'
  assert.throws(() => extractJson(text, 'Head Chef'), /Head Chef returned invalid JSON/)
})

test('repairModelJson: is idempotent on already-valid JSON', () => {
  const json = '{"a":[1,2,3]}'
  assert.equal(repairModelJson(json), json)
})

test('repairModelJson: does not alter brace/bracket characters that appear inside string values', () => {
  const json = '{"title":"a {weird} [title]", "steps":["do it"]'
  const repaired = repairModelJson(json)
  assert.deepEqual(JSON.parse(repaired), { title: 'a {weird} [title]', steps: ['do it'] })
})

// ---------------------------------------------------------------------------
// Orchestration: Groq (Head Chef) runs first; OpenAI (Sous Chef) and
// Anthropic (Critic) then run in parallel via Promise.all. All provider
// calls are mocked at the fetch layer — no real API calls are made.
// ---------------------------------------------------------------------------

function fourDishesPayload() {
  return {
    recipes: [
      { title: 'Skillet Eggs', description: 'd1', cuisine: 'american', mood: 'quick', servings: 2, serving_note: 'n', ingredients: ['egg'], steps: ['cook'] },
      { title: 'Garlic Soup', description: 'd2', cuisine: 'french', mood: 'comforting', servings: 2, serving_note: 'n', ingredients: ['garlic'], steps: ['simmer'] },
      { title: 'Herb Salad', description: 'd3', cuisine: 'mediterranean', mood: 'light', servings: 2, serving_note: 'n', ingredients: ['herbs'], steps: ['toss'] },
      { title: 'Baked Frittata', description: 'd4', cuisine: 'italian', mood: 'indulgent', servings: 2, serving_note: 'n', ingredients: ['egg'], steps: ['bake'] },
    ],
  }
}

function sousReviewsPayload() {
  return {
    reviews: fourDishesPayload().recipes.map((d) => ({ title: d.title, notes: [`season the ${d.title}`] })),
  }
}

function criticReviewsPayload() {
  return {
    reviews: fourDishesPayload().recipes.map((d) => ({
      title: d.title, rating: 4, approved: true, verdict: `${d.title} looks great.`, final_touches: [],
    })),
  }
}

function groqOk(payload) {
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }] }) }
}
function openaiOk(payload) {
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }] }) }
}
function anthropicOk(payload) {
  return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: JSON.stringify(payload) }] }) }
}

function makeContext() {
  const errors = []
  return { log: { error: (...args) => errors.push(args) }, errors }
}

function baseReq(overrides = {}) {
  return {
    method: 'POST',
    headers: { 'x-forwarded-for': `test-ip-${Math.random().toString(36).slice(2)}` },
    body: { ingredients: 'eggs, rice, garlic' },
    ...overrides,
  }
}

async function withMockedFetch(impl, fn) {
  const original = global.fetch
  global.fetch = impl
  try {
    await fn()
  } finally {
    global.fetch = original
  }
}

test('handler: happy path calls Groq first, then OpenAI + Anthropic, and merges results by recipe index', async () => {
  const callOrder = []
  const fetchImpl = async (url) => {
    if (url.includes('groq.com')) {
      callOrder.push('groq')
      return groqOk(fourDishesPayload())
    }
    if (url.includes('openai.com')) {
      callOrder.push('openai')
      return openaiOk(sousReviewsPayload())
    }
    if (url.includes('anthropic.com')) {
      callOrder.push('anthropic')
      return anthropicOk(criticReviewsPayload())
    }
    throw new Error('unexpected fetch to ' + url)
  }

  await withMockedFetch(fetchImpl, async () => {
    const context = makeContext()
    await brigade(context, baseReq())

    assert.equal(context.res.status, 200)
    assert.equal(callOrder[0], 'groq')
    assert.deepEqual(new Set(callOrder.slice(1)), new Set(['openai', 'anthropic']))

    const { recipes } = context.res.body
    assert.equal(recipes.length, 4)
    assert.equal(recipes[0].head.title, 'Skillet Eggs')
    assert.equal(recipes[0].sous.notes[0], 'season the Skillet Eggs')
    assert.equal(recipes[0].critic.rating, 4)
    assert.equal(recipes[0].critic.approved, true)
    assert.match(recipes[0].id, /^\d+-1-skillet-eggs$/)
  })
})

test('handler: dispatches Sous Chef and Critic concurrently, not sequentially (Promise.all)', async () => {
  const starts = {}
  const fetchImpl = async (url) => {
    if (url.includes('groq.com')) return groqOk(fourDishesPayload())
    if (url.includes('openai.com')) {
      starts.openai = Date.now()
      await new Promise((resolve) => setTimeout(resolve, 60))
      return openaiOk(sousReviewsPayload())
    }
    if (url.includes('anthropic.com')) {
      starts.anthropic = Date.now()
      await new Promise((resolve) => setTimeout(resolve, 5))
      return anthropicOk(criticReviewsPayload())
    }
    throw new Error('unexpected fetch to ' + url)
  }

  await withMockedFetch(fetchImpl, async () => {
    const context = makeContext()
    await brigade(context, baseReq())
    assert.equal(context.res.status, 200)
    // If these were sequential (await openai, then await anthropic), the
    // anthropic call would start ~60ms after the openai call starts. If
    // dispatched together via Promise.all, both start within a few ms of
    // each other regardless of openai's artificial delay.
    assert.ok(Math.abs(starts.anthropic - starts.openai) < 30, `expected concurrent dispatch, got ${JSON.stringify(starts)}`)
  })
})

test('handler: regression — identical results whether Azure delivers req.body as an object or as a JSON string', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('groq.com')) return groqOk(fourDishesPayload())
    if (url.includes('openai.com')) return openaiOk(sousReviewsPayload())
    if (url.includes('anthropic.com')) return anthropicOk(criticReviewsPayload())
    throw new Error('unexpected fetch to ' + url)
  }

  await withMockedFetch(fetchImpl, async () => {
    const payload = { ingredients: 'eggs, rice, garlic' }
    const ip = `test-ip-${Math.random().toString(36).slice(2)}`

    const contextObj = makeContext()
    await brigade(contextObj, baseReq({ headers: { 'x-forwarded-for': ip }, body: payload }))

    const contextStr = makeContext()
    await brigade(contextStr, baseReq({ headers: { 'x-forwarded-for': `${ip}-2` }, body: JSON.stringify(payload) }))

    assert.equal(contextObj.res.status, 200)
    assert.equal(contextStr.res.status, 200)
    const titlesFromObject = contextObj.res.body.recipes.map((r) => r.head.title)
    const titlesFromString = contextStr.res.body.recipes.map((r) => r.head.title)
    assert.deepEqual(titlesFromObject, titlesFromString)
  })
})

test('handler: rejects non-POST methods with 405', async () => {
  const context = makeContext()
  await brigade(context, baseReq({ method: 'GET' }))
  assert.equal(context.res.status, 405)
})

test('handler: rejects a request with no ingredients with 400', async () => {
  const context = makeContext()
  await brigade(context, baseReq({ body: { ingredients: '' } }))
  assert.equal(context.res.status, 400)
})

test('handler: returns 502 when a provider call fails', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('groq.com')) {
      return { ok: false, status: 500, json: async () => ({ error: { message: 'boom' } }) }
    }
    throw new Error('unexpected fetch to ' + url)
  }

  await withMockedFetch(fetchImpl, async () => {
    const context = makeContext()
    await brigade(context, baseReq())
    assert.equal(context.res.status, 502)
    assert.equal(context.errors.length, 1)
  })
})

test('handler: returns 502 when Head Chef returns fewer than four dishes', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('groq.com')) return groqOk({ recipes: [fourDishesPayload().recipes[0]] })
    throw new Error('unexpected fetch to ' + url)
  }

  await withMockedFetch(fetchImpl, async () => {
    const context = makeContext()
    await brigade(context, baseReq())
    assert.equal(context.res.status, 502)
  })
})

test('handler: enforces the per-IP rate limit and returns 429 once exceeded', async () => {
  const ip = `rate-limit-ip-${Math.random().toString(36).slice(2)}`
  const context = makeContext()
  let lastStatus
  for (let i = 0; i < 7; i += 1) {
    // Empty ingredients so each call resolves fast (400) without needing
    // provider mocks; the rate-limit check runs before ingredients are read.
    await brigade(context, baseReq({ headers: { 'x-forwarded-for': ip }, body: { ingredients: '' } }))
    lastStatus = context.res.status
  }
  assert.equal(lastStatus, 429)
})
