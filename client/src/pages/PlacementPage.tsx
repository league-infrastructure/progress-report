import { useState } from 'react'

interface PQuestion {
  id: string
  band: string
  type: string
  category: string
  question: string
  code: string | null
  options: string[]
}
interface BandScore {
  id: string
  label: string
  level: string
  correct: number
  total: number
  pct: number
  mastered: boolean
}
interface PlacementResult {
  score: number
  correctCount: number
  total: number
  masteryPct: number
  bandScores: BandScore[]
  recommended: { level: string; lesson: string; label: string; note?: string }
}

const LEVEL_NAMES: Record<string, string> = {
  'python-apprentice': 'Python Apprentice',
  'python-games': 'Python Games',
}

function prettyLesson(lesson: string): string {
  if (lesson === 'complete') return ''
  return lesson.replace(/^lessons\//, '')
}

export function PlacementPage() {
  const [phase, setPhase] = useState<'intro' | 'quiz' | 'result'>('intro')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [questions, setQuestions] = useState<PQuestion[]>([])
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [result, setResult] = useState<PlacementResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [language, setLanguage] = useState<'python' | 'java'>('python')

  const wrap = 'mx-auto max-w-2xl px-4 py-10'

  async function startTest(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/quiz/placement')
      if (!res.ok) throw new Error('Could not load the placement test.')
      const data = (await res.json()) as { questions: PQuestion[] }
      setQuestions(data.questions)
      setPhase('quiz')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the placement test.')
    } finally {
      setBusy(false)
    }
  }

  async function submitTest() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/quiz/placement/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, answers }),
      })
      if (!res.ok) throw new Error('Could not score the placement test.')
      setResult((await res.json()) as PlacementResult)
      setPhase('result')
      window.scrollTo(0, 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not score the placement test.')
    } finally {
      setBusy(false)
    }
  }

  // ---- intro ----
  if (phase === 'intro') {
    return (
      <div className={wrap}>
        <h1 className="text-2xl font-bold text-slate-800">Placement Test</h1>
        <p className="mt-2 text-slate-600">
          Find out where you’d start. Choose a language, enter your details, and take a short test.
        </p>

        <div className="mt-4">
          <span className="text-sm text-slate-600">Language</span>
          <div className="mt-1 inline-flex overflow-hidden rounded border border-slate-300">
            {(['python', 'java'] as const).map((lang) => (
              <button key={lang} type="button" onClick={() => setLanguage(lang)}
                className={`px-4 py-1.5 text-sm capitalize ${language === lang ? 'bg-blue-600 text-white' : 'bg-white text-slate-700'}`}>
                {lang}
              </button>
            ))}
          </div>
        </div>

        {language === 'java' ? (
          <div className="mt-6 rounded bg-amber-50 p-4 text-sm text-amber-800">
            The <strong>Java</strong> placement test is coming soon — Java content will be added later.
            For now, choose <strong>Python</strong>.
          </div>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={startTest}>
            <label className="block text-sm text-slate-700">
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} required
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2" placeholder="Your name" />
            </label>
            <label className="block text-sm text-slate-700">
              Email
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2" placeholder="you@example.com" />
            </label>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button type="submit" disabled={busy}
              className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50">
              {busy ? 'Loading…' : 'Begin placement test'}
            </button>
          </form>
        )}
        <p className="mt-6 text-xs text-slate-400">40 multiple-choice questions · auto-graded · ~20 minutes.</p>
      </div>
    )
  }

  // ---- result ----
  if (phase === 'result' && result) {
    const r = result.recommended
    const lesson = prettyLesson(r.lesson)
    return (
      <div className={wrap}>
        <h1 className="text-2xl font-bold text-slate-800">Your placement, {name || 'there'}</h1>
        <div className="my-4 rounded-lg bg-blue-50 p-4">
          <p className="text-sm text-slate-500">Recommended starting point</p>
          <p className="text-xl font-bold text-blue-800">
            {LEVEL_NAMES[r.level] ?? r.level}{lesson ? ` · ${lesson}` : ''}
          </p>
          {r.note && <p className="mt-1 text-sm text-slate-600">{r.note}</p>}
          <p className="mt-2 text-sm text-slate-600">Overall score: {result.score}% ({result.correctCount}/{result.total})</p>
        </div>
        <h2 className="mt-6 mb-2 font-semibold text-slate-700">How you did by topic</h2>
        <table className="min-w-full overflow-hidden rounded border border-slate-200 text-sm">
          <tbody className="divide-y divide-slate-100">
            {result.bandScores.map((b) => (
              <tr key={b.id}>
                <td className="px-3 py-2 text-slate-700">{b.label}</td>
                <td className="px-3 py-2 text-slate-600">{b.correct}/{b.total}</td>
                <td className="px-3 py-2">
                  <span className={b.mastered ? 'text-green-700' : 'text-amber-700'}>
                    {b.pct}% {b.mastered ? '✓' : ''}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-4 text-xs text-slate-400">
          Mastery threshold is {result.masteryPct}%. You’re placed at the start of the first topic below mastery.
        </p>
        <a href="/login" className="mt-6 inline-block text-blue-600 underline">← Back to sign in</a>
      </div>
    )
  }

  // ---- quiz ----
  const answeredCount = questions.filter((q) => (answers[q.id] ?? '') !== '').length
  return (
    <div className={wrap}>
      <h1 className="text-2xl font-bold text-slate-800">Python Placement Test</h1>
      <p className="mb-6 text-slate-500">{answeredCount} of {questions.length} answered. Answer as many as you can.</p>
      <ol className="space-y-5">
        {questions.map((q, i) => (
          <li key={q.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="font-medium text-slate-800">{i + 1}. {q.question}</p>
            {q.code && <pre className="my-2 overflow-x-auto rounded bg-slate-900 p-3 text-xs text-slate-100">{q.code}</pre>}
            <div className="mt-2 space-y-1">
              {q.options.map((opt) => (
                <label key={opt} className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="radio" name={q.id} value={opt}
                    checked={answers[q.id] === opt}
                    onChange={() => setAnswers((a) => ({ ...a, [q.id]: opt }))} />
                  {opt}
                </label>
              ))}
            </div>
          </li>
        ))}
      </ol>
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      <button onClick={submitTest} disabled={busy}
        className="mt-6 rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50">
        {busy ? 'Scoring…' : 'See my placement'}
      </button>
    </div>
  )
}
