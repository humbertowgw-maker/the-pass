import { neonClient } from './auth.js'

const COOK_ID_KEY = 'pass_analytics_cook_id'

function getAnonymousCookId() {
  let cookId = localStorage.getItem(COOK_ID_KEY)
  if (!cookId) {
    cookId = crypto.randomUUID()
    localStorage.setItem(COOK_ID_KEY, cookId)
  }
  return cookId
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Records a completed recipe round without sending ingredients, recipe text,
 * names, email addresses, or account IDs.
 */
export async function recordGenerationEvent(recipeCount) {
  try {
    const cookHash = await sha256(getAnonymousCookId())
    const { error } = await neonClient
      .from('generation_events')
      .insert({
        cook_hash: cookHash,
        recipe_count: Math.max(1, Math.min(12, Number(recipeCount) || 1)),
      })
    if (error) throw error
  } catch {
    // Analytics must never interrupt a cook's recipe generation.
  }
}
