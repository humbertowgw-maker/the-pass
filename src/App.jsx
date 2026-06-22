import { useState } from 'react'

const STATIONS = [
  { key: 'head', station: 'Station 1', name: 'Head Chef', provider: 'GROQ · LLAMA-3.3-70B' },
  { key: 'sous', station: 'Station 2', name: 'Sous Chef', provider: 'OPENAI · GPT' },
  { key: 'critic', station: 'The Pass', name: 'The Critic', provider: 'CLAUDE' },
]

export default function App() {
  const [ingredients, setIngredients] = useState('')
  const [running, setRunning] = useState(false)
  const [active, setActive] = useState(null)
  const [result, setResult] = useState(null)   // { head, sous, critic }
  const [error, setError] = useState(null)

  async function cook() {
    if (!ingredients.trim() || running) return
    setRunning(true); setError(null); setResult(null); setActive('head')

    try {
      const res = await fetch('/api/brigade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredients }),
      })
      if (!res.ok) {
        const t = await res.text()
        throw new Error(t || `The kitchen returned ${res.status}.`)
      }
      const data = await res.json()
      // reveal stations in sequence for the pass effect
      setActive('sous'); await wait(500)
      setActive('critic'); await wait(500)
      setActive(null)
      setResult(data)
    } catch (e) {
      setActive(null)
      setError(e.message || 'The kitchen went dark. Try again.')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="wrap">
      <header className="masthead">
        <div className="eyebrow">Multi-Model Kitchen Brigade</div>
        <h1>The <span className="fire">Pass</span></h1>
        <p className="sub">
          Tell the kitchen what's in your fridge. A head chef invents the dish,
          a sous chef refines it, and a critic decides whether it leaves the pass.
          Three AI models, one service.
        </p>
      </header>

      <div className="ticket">
        <div className="ticket-label">
          <span>Order Ticket — On Hand</span>
          <span>{ingredients.length} chars</span>
        </div>
        <textarea
          value={ingredients}
          onChange={(e) => setIngredients(e.target.value)}
          placeholder="eggs, day-old bread, parmesan, garlic, half an onion, butter, chili flakes..."
          disabled={running}
        />
        <div className="controls">
          <button className="btn" onClick={cook} disabled={running || !ingredients.trim()}>
            {running ? 'Firing…' : 'Fire the Pass'}
          </button>
          <span className="hint">List what you actually have. Pantry staples assumed.</span>
        </div>
      </div>

      {(running || result) && (
        <div className="rail">
          {STATIONS.map((s) => {
            const isActive = active === s.key
            const isDone = result && result[s.key]
            return (
              <div key={s.key} className={`docket ${isActive ? 'active' : ''} ${isDone ? 'done' : ''}`}>
                <div className="docket-head">
                  <span className="station">{s.station}</span>
                  <span className="chef-name">{s.name}</span>
                  <span className="provider-tag">{s.provider}</span>
                  <span className="status-dot" />
                </div>
                <div className="docket-body">
                  {isDone && s.key === 'head' && <Dish d={result.head} />}
                  {isDone && s.key === 'sous' && <Refine d={result.sous} />}
                  {isDone && s.key === 'critic' && <Verdict d={result.critic} />}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {error && <div className="err">{error}</div>}

      <footer>The Pass · Deployed on Azure Static Web Apps · White Glove</footer>
    </div>
  )
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)) }

function Dish({ d }) {
  if (!d) return null
  return (
    <div>
      <div className="recipe-title">{d.title}</div>
      {d.description && <div className="recipe-desc">{d.description}</div>}
      <div className="sec-label">Mise en Place</div>
      <ul className="ing-list">{(d.ingredients || []).map((i, k) => <li key={k}>{i}</li>)}</ul>
      <div className="sec-label">Method</div>
      <ol className="step-list">{(d.steps || []).map((s, k) => <li key={k}>{s}</li>)}</ol>
    </div>
  )
}

function Refine({ d }) {
  if (!d) return null
  return (
    <div>
      <div className="sec-label">Sous Chef's Corrections</div>
      {(d.notes || []).map((n, k) => <div className="note" key={k}>{n}</div>)}
    </div>
  )
}

function Verdict({ d }) {
  if (!d) return null
  const stars = '★'.repeat(d.rating || 0) + '☆'.repeat(Math.max(0, 5 - (d.rating || 0)))
  return (
    <div className="verdict">
      <div className="stars">{stars}</div>
      <div className="verdict-text">"{d.verdict}"</div>
      <div className="verdict-sig">— The Critic, at the pass</div>
    </div>
  )
}
