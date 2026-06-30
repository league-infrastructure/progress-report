import { useCallback, useEffect, useState } from 'react'

// ---- API shapes (mirror server/src/routes/quiz.ts student routes) ----

interface QuizListItem {
  id: number
  status: 'assigned' | 'completed' | string
  lessonId: number
  lessonName: string
  module: string | null
  levelId: number
  createdAt: string
}
interface PublicQuestion {
  id: string
  type: 'multiple_choice' | 'short_answer'
  category: string
  question: string
  code: string | null
  options: string[]
}
interface QuizQuestions {
  quizId: number
  status: string
  questions: PublicQuestion[]
}
interface QuestionResult {
  questionId: string
  correct: boolean
  studentAnswer: string
}
interface GradeResult {
  score: number
  passed: boolean
  correctCount: number
  total: number
  results: QuestionResult[]
}

const wrap = 'mx-auto max-w-2xl px-4 py-8'

/** Send the student to GitHub login, preserving nowhere special — the
 *  callback always returns them to /quiz/dashboard. */
function goToLogin() {
  window.location.href = '/api/auth/github'
}

/** Fetch helper that treats a 401 as "not logged in" → bounce to GitHub. */
async function studentFetch(input: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init)
  if (res.status === 401) {
    goToLogin()
    throw new Error('Redirecting to sign in…')
  }
  return res
}

export function StudentDashboardPage() {
  const [quizzes, setQuizzes] = useState<QuizListItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<number | null>(null)

  const loadQuizzes = useCallback(async () => {
    setError(null)
    try {
      const res = await studentFetch('/api/quiz/student/quizzes')
      if (!res.ok) throw new Error('Could not load your quizzes.')
      setQuizzes((await res.json()) as QuizListItem[])
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('Redirecting')) return
      setError(e instanceof Error ? e.message : 'Could not load your quizzes.')
    }
  }, [])

  useEffect(() => {
    void loadQuizzes()
  }, [loadQuizzes])

  if (activeId !== null) {
    return (
      <TakeQuiz
        quizId={activeId}
        onDone={() => {
          setActiveId(null)
          void loadQuizzes()
        }}
      />
    )
  }

  if (error) {
    return (
      <div className={wrap}>
        <p className="text-red-600">{error}</p>
        <button onClick={() => void loadQuizzes()} className="mt-3 text-sm text-blue-600 underline">
          Try again
        </button>
      </div>
    )
  }
  if (!quizzes) {
    return <div className={wrap}><p className="text-slate-500">Loading your quizzes…</p></div>
  }

  return (
    <div className={wrap}>
      <h1 className="text-2xl font-bold text-slate-800">My Quizzes</h1>
      <p className="mb-6 text-slate-500">Quizzes your instructor has assigned to you.</p>

      {quizzes.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-slate-500">
          You don't have any quizzes yet. When an instructor assigns one, it'll show up here.
        </div>
      ) : (
        <ul className="space-y-3">
          {quizzes.map((q) => (
            <li
              key={q.id}
              className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div>
                <p className="font-medium text-slate-800">{q.lessonName}</p>
                {q.module && <p className="text-xs text-slate-500">{q.module}</p>}
                <p className="mt-1 text-xs text-slate-400">
                  Assigned {new Date(q.createdAt).toLocaleDateString()}
                </p>
              </div>
              {q.status === 'completed' ? (
                <span className="rounded bg-green-100 px-3 py-1 text-sm font-medium text-green-700">
                  Completed
                </span>
              ) : (
                <button
                  onClick={() => setActiveId(q.id)}
                  className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  Start quiz
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---- Take-a-quiz view (mirrors QuizTokenPage, scoped to the student route) ----

function TakeQuiz({ quizId, onDone }: { quizId: number; onDone: () => void }) {
  const [quiz, setQuiz] = useState<QuizQuestions | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [result, setResult] = useState<GradeResult | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let active = true
    studentFetch(`/api/quiz/student/quizzes/${quizId}/questions`)
      .then(async (res) => {
        if (!res.ok) {
          const e = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(e.error ?? 'This quiz could not be loaded.')
        }
        return res.json() as Promise<QuizQuestions>
      })
      .then((q) => { if (active) setQuiz(q) })
      .catch((e: Error) => { if (active && !e.message.startsWith('Redirecting')) setLoadError(e.message) })
    return () => { active = false }
  }, [quizId])

  async function handleSubmit() {
    setSubmitting(true)
    try {
      const res = await studentFetch(`/api/quiz/student/quizzes/${quizId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers }),
      })
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(e.error ?? 'Submission failed.')
      }
      setResult((await res.json()) as GradeResult)
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('Redirecting')) return
      setLoadError(e instanceof Error ? e.message : 'Submission failed.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loadError && !result) {
    return (
      <div className={wrap}>
        <p className="text-red-600">{loadError}</p>
        <button onClick={onDone} className="mt-3 text-sm text-blue-600 underline">Back to my quizzes</button>
      </div>
    )
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
              <p className="text-slate-600">
                Question {i + 1} — your answer: {r.studentAnswer || <em className="text-slate-400">blank</em>}
              </p>
              <p className={r.correct ? 'font-medium text-green-700' : 'font-medium text-red-700'}>
                {r.correct ? 'Correct' : 'Incorrect'}
              </p>
            </li>
          ))}
        </ol>
        <button onClick={onDone} className="mt-6 rounded bg-slate-700 px-4 py-2 text-sm text-white hover:bg-slate-800">
          Back to my quizzes
        </button>
      </div>
    )
  }

  const allAnswered = quiz.questions.every((q) => (answers[q.id] ?? '').trim() !== '')

  return (
    <div className={wrap}>
      <button onClick={onDone} className="mb-4 text-sm text-blue-600 underline">← My quizzes</button>
      <h1 className="text-2xl font-bold text-slate-800">Quiz</h1>
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
