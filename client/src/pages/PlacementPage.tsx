import { useState } from 'react'

// Public placement-test landing page. The 40-question assessment itself
// (Quiz-App/quizzes/placement-assessment.json) is built; the runtime grading +
// result email flow is not wired yet, so this collects name/email and explains
// what the test does. UI placeholder per Sprint 002 scope (placement deferred).

export function PlacementPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const wrap = 'mx-auto max-w-xl px-4 py-10'

  if (submitted) {
    return (
      <div className={wrap}>
        <h1 className="text-2xl font-bold text-slate-800">Thanks, {name || 'there'}!</h1>
        <p className="mt-3 text-slate-600">
          Your 40-question Python placement assessment is being finalized. When it’s live, you’ll
          answer questions spanning the full curriculum and we’ll tell you which course
          (<strong>Python Apprentice</strong> or <strong>Python Games</strong>) and which lesson to start at —
          and email the result to {email || 'your email'}.
        </p>
        <a href="/login" className="mt-6 inline-block text-blue-600 underline">← Back to sign in</a>
      </div>
    )
  }

  return (
    <div className={wrap}>
      <h1 className="text-2xl font-bold text-slate-800">Python Placement Test</h1>
      <p className="mt-2 text-slate-600">
        Not sure where you’d start? This free 40-question test places you into the right League
        Python course and lesson. Enter your details to begin.
      </p>

      <form
        className="mt-6 space-y-4"
        onSubmit={(e) => { e.preventDefault(); setSubmitted(true) }}
      >
        <label className="block text-sm text-slate-700">
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
            placeholder="Your name"
          />
        </label>
        <label className="block text-sm text-slate-700">
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
            placeholder="you@example.com"
          />
        </label>
        <button type="submit" className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700">
          Begin placement test
        </button>
      </form>

      <p className="mt-6 text-xs text-slate-400">
        40 multiple-choice questions · auto-graded · ~20 minutes.
      </p>
    </div>
  )
}
