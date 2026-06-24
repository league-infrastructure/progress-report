import { useEffect, useState } from 'react'
import { useRoute } from 'wouter'

interface PublicQuestion {
  id: string
  type: 'multiple_choice' | 'short_answer'
  category: string
  question: string
  code: string | null
  options: string[]
}
interface TokenQuiz {
  quizId: number
  lessonName: string | null
  status: string
  questions: PublicQuestion[]
}
interface QuestionResult {
  questionId: string
  correct: boolean
  studentAnswer: string
  correctAnswer: string
  explanation: string
}
interface GradeResult {
  score: number
  passed: boolean
  correctCount: number
  total: number
  results: QuestionResult[]
}

export function QuizTokenPage() {
  const [, params] = useRoute('/quiz/t/:token')
  const token = params?.token ?? ''

  const [quiz, setQuiz] = useState<TokenQuiz | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [result, setResult] = useState<GradeResult | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let active = true
    fetch(`/api/quiz/token/${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (!res.ok) {
          const e = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(e.error ?? 'This quiz link is not valid.')
        }
        return res.json() as Promise<TokenQuiz>
      })
      .then((q) => { if (active) setQuiz(q) })
      .catch((e: Error) => { if (active) setLoadError(e.message) })
    return () => { active = false }
  }, [token])

  async function handleSubmit() {
    setSubmitting(true)
    try {
      const res = await fetch(`/api/quiz/token/${encodeURIComponent(token)}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers }),
      })
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(e.error ?? 'Submission failed.')
      }
      setResult(await res.json())
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Submission failed.')
    } finally {
      setSubmitting(false)
    }
  }

  const wrap = 'mx-auto max-w-2xl px-4 py-8'

  if (loadError && !result) {
    return <div className={wrap}><p className="text-red-600">{loadError}</p></div>
  }
  if (!quiz) {
    return <div className={wrap}><p className="text-slate-500">Loading quiz…</p></div>
  }

  if (result) {
    return (
      <div className={wrap}>
        <h1 className="text-2xl font-bold text-slate-800">Your result</h1>
        <div className={`my-4 rounded-lg p-4 ${result.passed ? 'bg-green-50' : 'bg-red-50'}`}>
          <p className="text-3xl font-bold">{result.score}%</p>
          <p className={result.passed ? 'text-green-700' : 'text-red-700'}>
            {result.passed ? 'Passed 🎉' : 'Not passed — keep practicing!'} ({result.correctCount}/{result.total} correct)
          </p>
        </div>
        <ol className="space-y-3">
          {result.results.map((r, i) => (
            <li key={r.questionId} className="rounded border border-slate-200 p-3 text-sm">
              <p className="font-medium text-slate-700">
                {i + 1}. {r.correct ? <span className="text-green-600">✓ correct</span> : <span className="text-red-600">✗ incorrect</span>}
              </p>
              <p className="text-slate-600">Your answer: {r.studentAnswer || <em className="text-slate-400">blank</em>}</p>
              {!r.correct && <p className="text-slate-600">Correct answer: {r.correctAnswer}</p>}
              <p className="mt-1 text-slate-500">{r.explanation}</p>
            </li>
          ))}
        </ol>
      </div>
    )
  }

  const allAnswered = quiz.questions.every((q) => (answers[q.id] ?? '').trim() !== '')

  return (
    <div className={wrap}>
      <h1 className="text-2xl font-bold text-slate-800">{quiz.lessonName ?? 'Quiz'}</h1>
      <p className="mb-6 text-slate-500">{quiz.questions.length} questions · answer all to submit.</p>

      <ol className="space-y-6">
        {quiz.questions.map((q, i) => (
          <li key={q.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="font-medium text-slate-800">{i + 1}. {q.question}</p>
            {q.code && <pre className="my-2 overflow-x-auto rounded bg-slate-900 p-3 text-xs text-slate-100">{q.code}</pre>}
            {q.type === 'multiple_choice' ? (
              <div className="mt-2 space-y-1">
                {q.options.map((opt) => (
                  <label key={opt} className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="radio"
                      name={q.id}
                      value={opt}
                      checked={answers[q.id] === opt}
                      onChange={() => setAnswers((a) => ({ ...a, [q.id]: opt }))}
                    />
                    {opt}
                  </label>
                ))}
              </div>
            ) : (
              <input
                type="text"
                className="mt-2 w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
                value={answers[q.id] ?? ''}
                onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                placeholder="Your answer"
              />
            )}
          </li>
        ))}
      </ol>

      <button
        onClick={handleSubmit}
        disabled={!allAnswered || submitting}
        className="mt-6 rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {submitting ? 'Submitting…' : 'Submit quiz'}
      </button>
      {!allAnswered && <p className="mt-2 text-sm text-slate-500">Answer every question to enable submit.</p>}
    </div>
  )
}
