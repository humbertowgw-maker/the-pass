import { useMemo, useState } from 'react'

const STATIONS = [
  { key: 'head', station: 'Station 1', name: 'Head Chef', provider: 'GROQ · LLAMA-3.3-70B' },
  { key: 'sous', station: 'Station 2', name: 'Sous Chef', provider: 'OPENAI · GPT-4O-MINI' },
  { key: 'critic', station: 'The Pass', name: 'Claude', provider: 'ANTHROPIC · SONNET 4.6' },
]

const DEFAULT_PREFERENCES = {
  cuisine: 'Surprise me',
  mood: 'Anything',
  meal: 'Any meal',
  servings: 'Auto from ingredients',
}

const readStorage = (storage, key, fallback = []) => {
  try {
    return JSON.parse(storage.getItem(key)) || fallback
  } catch {
    return fallback
  }
}

export default function App() {
  const [ingredients, setIngredients] = useState('')
  const [running, setRunning] = useState(false)
  const [active, setActive] = useState(null)
  const [recipes, setRecipes] = useState([])
  const [selected, setSelected] = useState(0)
  const [error, setError] = useState(null)
  const [sessionRecipes, setSessionRecipes] = useState(() => readStorage(sessionStorage, 'pass_session_recipes'))
  const [saved, setSaved] = useState(() => readStorage(localStorage, 'pass_saved_recipes'))
  const [reviews, setReviews] = useState(() => readStorage(localStorage, 'pass_plate_reviews'))
  const [preferences, setPreferences] = useState(() => readStorage(localStorage, 'pass_preferences', DEFAULT_PREFERENCES))

  const selectedRecipe = recipes[selected]
  const savedIds = useMemo(() => new Set(saved.map((recipe) => recipe.id)), [saved])

  async function cook() {
    if (!ingredients.trim() || running) return
    setRunning(true)
    setError(null)
    setRecipes([])
    setSelected(0)
    setActive('head')

    try {
      const res = await fetch('/api/brigade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredients, previousRecipes: sessionRecipes, preferences }),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || `The kitchen returned ${res.status}.`)
      }
      const data = await res.json()
      setActive('sous')
      await wait(450)
      setActive('critic')
      await wait(450)
      setActive(null)
      setRecipes(data.recipes || [])
      const newMemory = [
        ...sessionRecipes,
        ...(data.recipes || []).map((recipe) => ({
          title: recipe.head.title,
          description: recipe.head.description,
        })),
      ].slice(-30)
      setSessionRecipes(newMemory)
      sessionStorage.setItem('pass_session_recipes', JSON.stringify(newMemory))
    } catch (e) {
      setActive(null)
      setError(e.message || 'The kitchen went dark. Try again.')
    } finally {
      setRunning(false)
    }
  }

  function toggleSave(recipe) {
    const next = savedIds.has(recipe.id)
      ? saved.filter((item) => item.id !== recipe.id)
      : [{ ...recipe, savedAt: new Date().toISOString() }, ...saved].slice(0, 50)
    setSaved(next)
    localStorage.setItem('pass_saved_recipes', JSON.stringify(next))
  }

  function addReview(review) {
    const next = [{ ...review, id: `${Date.now()}`, createdAt: new Date().toISOString() }, ...reviews].slice(0, 40)
    setReviews(next)
    localStorage.setItem('pass_plate_reviews', JSON.stringify(next))
  }

  function updatePreference(key, value) {
    const next = { ...preferences, [key]: value }
    setPreferences(next)
    localStorage.setItem('pass_preferences', JSON.stringify(next))
  }

  return (
    <div className="wrap">
      <header className="masthead">
        <div className="eyebrow">Multi-Model Kitchen Brigade</div>
        <h1>The <span className="fire">Pass</span></h1>
        <p className="sub">
          Put what you have on the ticket. The brigade creates four completely different dishes,
          remembers what it served this session, and lets the strongest plates rise toward the cookbook.
        </p>
      </header>

      <div className="ticket">
        <div className="ticket-label">
          <span>Order Ticket — On Hand</span>
          <span>{sessionRecipes.length} ideas remembered</span>
        </div>
        <textarea
          value={ingredients}
          onChange={(e) => setIngredients(e.target.value)}
          placeholder="eggs, day-old bread, parmesan, garlic, half an onion, butter, chili flakes..."
          disabled={running}
        />
        <PreferenceBar preferences={preferences} onChange={updatePreference} disabled={running} />
        <div className="controls">
          <button className="btn" onClick={cook} disabled={running || !ingredients.trim()}>
            {running ? 'Firing four plates…' : recipes.length ? 'Generate four new recipes' : 'Fire the Pass'}
          </button>
          <span className="hint">Every new round avoids recipes already served in this session.</span>
        </div>
      </div>

      {running && <KitchenRail active={active} />}

      {!!recipes.length && (
        <>
          <section className="section-block">
            <div className="section-kicker">Tonight&apos;s four</div>
            <div className="choice-grid">
              {recipes.map((recipe, index) => (
                <button
                  className={`choice-card ${selected === index ? 'selected' : ''}`}
                  key={recipe.id}
                  onClick={() => setSelected(index)}
                >
                  <span className="choice-number">0{index + 1}</span>
                  <span className="choice-title">{recipe.head.title}</span>
                  <span className="choice-desc">{recipe.head.description}</span>
                  <span className="choice-rating">{stars(recipe.critic.rating)} · {recipe.critic.approved ? 'Passed' : 'Held'}</span>
                </button>
              ))}
            </div>
          </section>

          {selectedRecipe && (
            <section className="selected-plate">
              <div className="plate-actions">
                <div>
                  <div className="section-kicker">Selected plate</div>
                  <h2>{selectedRecipe.head.title}</h2>
                </div>
                <button className="save-btn" onClick={() => toggleSave(selectedRecipe)}>
                  {savedIds.has(selectedRecipe.id) ? 'Saved ✓' : 'Save recipe'}
                </button>
              </div>
              <KitchenRail recipe={selectedRecipe} />
              <ReviewForm recipe={selectedRecipe} onSubmit={addReview} />
            </section>
          )}
        </>
      )}

      {error && <div className="err">{error}</div>}

      <TastingRoom reviews={reviews} saved={saved} />

      <footer>The Pass · Four plates per ticket · White Glove</footer>
    </div>
  )
}

function PreferenceBar({ preferences, onChange, disabled }) {
  const fields = [
    ['cuisine', 'Cuisine', ['Surprise me', 'American', 'Italian', 'Mexican', 'Mediterranean', 'Asian-inspired', 'Indian-inspired', 'Southern', 'Caribbean', 'French-inspired']],
    ['mood', 'In the mood for', ['Anything', 'Comfort food', 'Light & fresh', 'Quick & easy', 'Adventurous', 'Indulgent', 'Healthy-ish']],
    ['meal', 'Meal', ['Any meal', 'Breakfast', 'Lunch', 'Dinner', 'Snack', 'Dessert']],
    ['servings', 'Feed', ['Auto from ingredients', '1 person', '2 people', '4 people', '6 people']],
  ]

  return (
    <div className="preference-grid">
      {fields.map(([key, label, options]) => (
        <label key={key}>
          <span>{label}</span>
          <select value={preferences[key]} onChange={(event) => onChange(key, event.target.value)} disabled={disabled}>
            {options.map((option) => <option key={option}>{option}</option>)}
          </select>
        </label>
      ))}
    </div>
  )
}

function KitchenRail({ active = null, recipe = null }) {
  return (
    <div className="rail">
      {STATIONS.map((station) => {
        const done = Boolean(recipe?.[station.key])
        return (
          <div key={station.key} className={`docket ${active === station.key ? 'active' : ''} ${done ? 'done' : ''}`}>
            <div className="docket-head">
              <span className="station">{station.station}</span>
              <span className="chef-name">{station.name}</span>
              <span className="provider-tag">{station.provider}</span>
              <span className="status-dot" />
            </div>
            <div className="docket-body">
              {done && station.key === 'head' && <Dish d={recipe.head} />}
              {done && station.key === 'sous' && <Refine d={recipe.sous} />}
              {done && station.key === 'critic' && <Verdict d={recipe.critic} />}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Dish({ d }) {
  return (
    <div>
      <div className="recipe-title">{d.title}</div>
      <div className="recipe-desc">{d.description}</div>
      <div className="recipe-meta">
        <span>{d.cuisine || 'Chef’s choice'}</span>
        <span>{d.mood || 'Any mood'}</span>
        <span>Serves {d.servings || '?'}</span>
      </div>
      {d.serving_note && <div className="serving-note">{d.serving_note}</div>}
      <div className="sec-label">Mise en Place</div>
      <ul className="ing-list">{(d.ingredients || []).map((item, key) => <li key={key}>{item}</li>)}</ul>
      <div className="sec-label">Method</div>
      <ol className="step-list">{(d.steps || []).map((step, key) => <li key={key}>{step}</li>)}</ol>
    </div>
  )
}

function Refine({ d }) {
  return (
    <div>
      <div className="sec-label">Sous Chef&apos;s Corrections</div>
      {(d.notes || []).map((note, key) => <div className="note" key={key}>{note}</div>)}
    </div>
  )
}

function Verdict({ d }) {
  return (
    <div className="verdict">
      <div className={`approval ${d.approved === false ? 'held' : ''}`}>
        {d.approved === false ? 'Held at the pass' : 'Approved to serve'}
      </div>
      <div className="stars">{stars(d.rating)}</div>
      <div className="verdict-text">&quot;{d.verdict}&quot;</div>
      {(d.final_touches || []).map((touch, key) => <div className="final-touch" key={key}>{touch}</div>)}
      <div className="verdict-sig">— Claude, executive chef at the pass</div>
    </div>
  )
}

function ReviewForm({ recipe, onSubmit }) {
  const [quote, setQuote] = useState('')
  const [rating, setRating] = useState(5)
  const [photo, setPhoto] = useState('')

  function loadPhoto(event) {
    const file = event.target.files?.[0]
    if (!file) return
    if (file.size > 1_500_000) {
      event.target.value = ''
      return
    }
    const reader = new FileReader()
    reader.onload = () => setPhoto(String(reader.result))
    reader.readAsDataURL(file)
  }

  function submit(event) {
    event.preventDefault()
    if (!quote.trim()) return
    onSubmit({
      recipeId: recipe.id,
      title: recipe.head.title,
      recipe,
      quote: quote.trim(),
      rating,
      photo,
    })
    setQuote('')
    setRating(5)
    setPhoto('')
    event.currentTarget.reset()
  }

  return (
    <form className="review-form" onSubmit={submit}>
      <div>
        <div className="section-kicker">Cooked it?</div>
        <h3>Send this plate back to the tasting room.</h3>
      </div>
      <textarea
        className="review-input"
        value={quote}
        onChange={(event) => setQuote(event.target.value)}
        placeholder="Sounded nasty, but this was so good—you have to try it…"
      />
      <div className="review-controls">
        <label>Rating
          <select value={rating} onChange={(event) => setRating(Number(event.target.value))}>
            {[5, 4, 3, 2, 1].map((value) => <option value={value} key={value}>{value} stars</option>)}
          </select>
        </label>
        <label className="photo-label">Plate photo
          <input type="file" accept="image/*" onChange={loadPhoto} />
        </label>
        <button className="save-btn" type="submit">Post review</button>
      </div>
      <div className="local-note">For now, reviews and photos stay on this device while shared accounts and cloud storage are connected.</div>
    </form>
  )
}

function TastingRoom({ reviews, saved }) {
  const candidates = [...reviews]
    .filter((review) => review.rating >= 4)
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 6)

  return (
    <section className="tasting-room">
      <div className="section-kicker">Community tasting room</div>
      <h2>The plates people would make again.</h2>
      {!reviews.length ? (
        <div className="empty-feed">
          Cook a recipe, photograph the plate, and leave the first honest review.
          The best-reviewed dishes become cookbook candidates.
        </div>
      ) : (
        <div className="feed-grid">
          {reviews.map((review) => (
            <article className="feed-card" key={review.id}>
              {review.photo
                ? <img src={review.photo} alt={`User-cooked ${review.title}`} />
                : <div className="photo-placeholder">Plate photo</div>}
              <div className="feed-copy">
                <div className="feed-stars">{stars(review.rating)}</div>
                <blockquote>&quot;{review.quote}&quot;</blockquote>
                <strong>{review.title}</strong>
                <details>
                  <summary>Remake this recipe</summary>
                  <Dish d={review.recipe.head} />
                </details>
              </div>
            </article>
          ))}
        </div>
      )}

      <div className="cookbook-watch">
        <div>
          <div className="section-kicker">Cookbook watchlist</div>
          <h3>{candidates.length || saved.length} recipes in contention</h3>
        </div>
        <p>Only saved, approved, highly rated plates move toward an edited cookbook release.</p>
      </div>
    </section>
  )
}

function stars(rating = 0) {
  const safe = Math.max(0, Math.min(5, Math.round(rating)))
  return '★'.repeat(safe) + '☆'.repeat(5 - safe)
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
