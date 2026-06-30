import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

interface Lesson { id: number; levelId: number; name: string; module: string; order: number }
interface Level { id: number; slug: string; name: string; order: number; lessons: Lesson[] }
interface Student { id: number; name: string; githubUsername: string | null }
interface MyStudentRow {
  quizId: number
  status: string
  createdAt: string
  studentId: number
  studentName: string
  githubUsername: string | null
  lessonName: string
  score: number | null
  passed: boolean | null
  submittedAt: string | null
  parentNoteSentAt: string | null
}

interface ReviewData {
  quizId: number
  status: string
  studentName: string | null
  parentEmail: string | null
  lessonName: string | null
  score: number
  passed: boolean
  results: { questionId: string; correct: boolean; studentAnswer: string; correctAnswer: string; explanation: string }[]
  parentNote: string | null
  parentNoteSentAt: string | null
}

interface PreviewQ {
  id: string
  type: string
  category: string
  question: string
  code: string | null
  options: string[]
  answer: string
  explanation: string
}

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Request failed: ${url}`)
  return res.json()
}

// Mirror the server grader for the instructor's self-test preview.
function normalizePreview(s: string): string {
  return (s ?? '').toLowerCase().trim().replace(/\s+/g, ' ').replace(/[‘’‛′`]/g, "'").replace(/[“”″]/g, '"')
}

export function InstructorQuizTabPage() {
  const [filter, setFilter] = useState('')
  const [studentId, setStudentId] = useState<number | null>(null)
  const [lessonId, setLessonId] = useState<number | null>(null)
  const [bypass, setBypass] = useState(false)
  const [bypassReason, setBypassReason] = useState('')
  const [assignLink, setAssignLink] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [addGithub, setAddGithub] = useState('')
  const [addName, setAddName] = useState('')
  const [adding, setAdding] = useState(false)
  const [addErr, setAddErr] = useState<string | null>(null)
  // Parent-note review panel state
  const [review, setReview] = useState<ReviewData | null>(null)
  const [reviewNote, setReviewNote] = useState('')
  const [reviewBusy, setReviewBusy] = useState(false)
  const [reviewErr, setReviewErr] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [preview, setPreview] = useState<{ lessonName: string; questions: PreviewQ[] } | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [previewAnswers, setPreviewAnswers] = useState<Record<string, string>>({})
  const [previewResult, setPreviewResult] = useState<{
    score: number; passed: boolean; correctCount: number
    results: { q: PreviewQ; given: string; correct: boolean }[]
  } | null>(null)

  const { data: roster, error: rosterError, refetch: refetchRoster } = useQuery<Student[]>({
    queryKey: ['quiz', 'instructor', 'roster'],
    queryFn: () => getJSON<Student[]>('/api/quiz/instructor/roster'),
  })
  const { data: levels } = useQuery<Level[]>({
    queryKey: ['quiz', 'instructor', 'levels'],
    queryFn: () => getJSON<Level[]>('/api/quiz/instructor/levels'),
  })
  const { data: myStudents, refetch } = useQuery<MyStudentRow[]>({
    queryKey: ['quiz', 'instructor', 'my-students'],
    queryFn: () => getJSON<MyStudentRow[]>('/api/quiz/instructor/my-students'),
  })

  const filteredRoster = useMemo(() => {
    const all = roster ?? []
    const q = filter.trim().toLowerCase()
    if (!q) return all
    return all.filter(
      (s) => s.name.toLowerCase().includes(q) || (s.githubUsername ?? '').toLowerCase().includes(q),
    )
  }, [roster, filter])

  async function handleAssign() {
    if (!studentId || !lessonId) return
    setBusy(true); setErr(null); setAssignLink(null)
    try {
      const res = await fetch('/api/quiz/instructor/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, lessonId, bypassReason: bypass ? bypassReason || 'instructor override' : undefined }),
      })
      if (res.status === 409) {
        const e = (await res.json().catch(() => ({}))) as { error?: string; incomplete?: string[]; checked?: boolean }
        const list = (e.incomplete ?? []).join(', ')
        const base = e.error ?? 'Student has not completed the required recipes.'
        throw new Error(
          list
            ? `${base} Needs to finish: ${list}. Use “Bypass completion gate” to assign anyway.`
            : `${base} Use “Bypass completion gate” to assign anyway.`,
        )
      }
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(e.error ?? 'Assign failed')
      }
      const data = (await res.json()) as { quizId: number; tokenPath: string }
      setAssignLink(`${window.location.origin}${data.tokenPath}`)
      refetch()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Assign failed')
    } finally {
      setBusy(false)
    }
  }

  async function handleAddStudent() {
    const gh = addGithub.trim()
    if (!gh) return
    setAdding(true); setAddErr(null)
    try {
      const res = await fetch('/api/quiz/instructor/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          githubUsername: gh,
          name: addName.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(e.error ?? 'Could not add student')
      }
      const created = (await res.json()) as Student
      await refetchRoster()
      setStudentId(created.id)
      setAddGithub(''); setAddName('')
    } catch (e) {
      setAddErr(e instanceof Error ? e.message : 'Could not add student')
    } finally {
      setAdding(false)
    }
  }

  async function openReview(quizId: number) {
    setReviewBusy(true); setReviewErr(null); setReview(null)
    try {
      const data = await getJSON<ReviewData>(`/api/quiz/instructor/quizzes/${quizId}/review`)
      setReview(data)
      setReviewNote(data.parentNote ?? '')
    } catch {
      setReviewErr('Could not load this quiz for review.')
    } finally {
      setReviewBusy(false)
    }
  }

  async function sendParentNote() {
    if (!review) return
    setSending(true); setReviewErr(null)
    try {
      const res = await fetch(`/api/quiz/instructor/quizzes/${review.quizId}/send-parent-note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: reviewNote }),
      })
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(e.error ?? 'Could not send note')
      }
      const data = (await res.json()) as { parentNoteSentAt: string; emailed: boolean }
      setReview((r) => (r ? { ...r, parentNoteSentAt: data.parentNoteSentAt, parentNote: reviewNote } : r))
      refetch()
    } catch (e) {
      setReviewErr(e instanceof Error ? e.message : 'Could not send note')
    } finally {
      setSending(false)
    }
  }

  async function handlePreview() {
    if (!lessonId) return
    setPreviewBusy(true); setPreview(null); setPreviewResult(null); setPreviewAnswers({}); setErr(null)
    try {
      const data = await getJSON<{ lessonName: string; questions: PreviewQ[] }>(
        `/api/quiz/instructor/preview?lessonId=${lessonId}`,
      )
      setPreview(data)
    } catch {
      setErr('Could not load preview')
    } finally {
      setPreviewBusy(false)
    }
  }

  function submitPreview() {
    if (!preview) return
    const results = preview.questions.map((q) => {
      const given = previewAnswers[q.id] ?? ''
      const correct =
        q.type === 'multiple_choice'
          ? given.trim() === q.answer.trim()
          : normalizePreview(given) === normalizePreview(q.answer)
      return { q, given, correct }
    })
    const correctCount = results.filter((r) => r.correct).length
    const score = results.length ? Math.round((correctCount / results.length) * 100) : 0
    setPreviewResult({ score, passed: score >= 70, correctCount, results })
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Quizzes</h1>
        <p className="text-slate-500">Assign a lesson quiz to a student and review their results.</p>
      </div>

      {/* Assign — always visible */}
      <div className="mb-8 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold text-slate-800">Give a quiz</h2>

        {rosterError && (
          <p className="mb-3 text-sm text-red-600">Couldn’t load your roster. Make sure you’re signed in as an instructor.</p>
        )}
        {roster && roster.length === 0 && (
          <p className="mb-3 text-sm text-amber-700">
            No students in your roster yet. Students sync from Pike13 when you log in — try the “Sync Pike13” button, then refresh.
          </p>
        )}

        <div className="mb-3 flex flex-wrap items-end gap-2 rounded bg-slate-50 p-2">
          <span className="text-sm text-slate-600">Add a student by GitHub username:</span>
          <input value={addGithub} onChange={(e) => setAddGithub(e.target.value)} placeholder="github-username"
            className="rounded border border-slate-300 px-2 py-1 text-sm" />
          <input value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="name (optional)"
            className="rounded border border-slate-300 px-2 py-1 text-sm" />
          <button type="button" onClick={handleAddStudent} disabled={!addGithub.trim() || adding}
            className="rounded bg-slate-700 px-3 py-1.5 text-sm text-white hover:bg-slate-800 disabled:opacity-50">
            {adding ? 'Adding…' : 'Add'}
          </button>
          {addErr && <span className="text-sm text-red-600">{addErr}</span>}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm text-slate-600">
            Find student
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="name or GitHub username"
              className="ml-2 rounded border border-slate-300 px-2 py-1" />
          </label>
          <label className="text-sm text-slate-600">
            Student
            <select value={studentId ?? ''} onChange={(e) => setStudentId(Number(e.target.value))}
              className="ml-2 rounded border border-slate-300 px-2 py-1">
              <option value="" disabled>Select…</option>
              {filteredRoster.map((s) => (
                <option key={s.id} value={s.id}>{s.name}{s.githubUsername ? ` (${s.githubUsername})` : ''}</option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-600">
            Lesson
            <select value={lessonId ?? ''} onChange={(e) => setLessonId(Number(e.target.value))}
              className="ml-2 rounded border border-slate-300 px-2 py-1">
              <option value="" disabled>Select…</option>
              {(levels ?? []).map((lvl) => (
                <optgroup key={lvl.id} label={lvl.name}>
                  {lvl.lessons.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 text-sm text-slate-600">
            <input type="checkbox" checked={bypass} onChange={(e) => setBypass(e.target.checked)} />
            Bypass completion gate
          </label>
          {bypass && (
            <input value={bypassReason} onChange={(e) => setBypassReason(e.target.value)} placeholder="Reason"
              className="rounded border border-slate-300 px-2 py-1 text-sm" />
          )}
          <button onClick={handleAssign} disabled={!studentId || !lessonId || busy}
            className="rounded bg-green-600 px-3 py-1.5 text-sm text-white hover:bg-green-700 disabled:opacity-50">
            {busy ? 'Assigning…' : 'Assign quiz'}
          </button>
          <button type="button" onClick={handlePreview} disabled={!lessonId || previewBusy}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            {previewBusy ? 'Loading…' : 'Preview quiz'}
          </button>
        </div>

        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
        {assignLink && (
          <div className="mt-3 rounded bg-green-50 p-3 text-sm">
            <p className="font-medium text-green-800">Quiz assigned. Share this link with the student:</p>
            <code className="break-all text-green-700">{assignLink}</code>
          </div>
        )}
      </div>

      {/* Quiz preview — the same experience a student gets (take, then grade) */}
      {preview && (
        <div className="mb-8 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-800">Preview · {preview.lessonName}</h2>
            <button onClick={() => { setPreview(null); setPreviewResult(null) }} className="text-sm text-slate-500 hover:underline">Close</button>
          </div>

          {previewResult ? (
            <>
              <div className={`mb-4 rounded-lg p-3 ${previewResult.passed ? 'bg-green-50' : 'bg-red-50'}`}>
                <span className="text-2xl font-bold">{previewResult.score}%</span>{' '}
                <span className={previewResult.passed ? 'text-green-700' : 'text-red-700'}>
                  {previewResult.passed ? 'Pass' : 'Fail'} ({previewResult.correctCount}/{previewResult.results.length})
                </span>
              </div>
              <ol className="space-y-3">
                {previewResult.results.map(({ q, given, correct }, i) => (
                  <li key={q.id} className="rounded border border-slate-200 p-3 text-sm">
                    <p className="font-medium text-slate-700">{i + 1}. {q.question}</p>
                    <p className="text-slate-600">Your answer: {given || <em className="text-slate-400">blank</em>}</p>
                    <p className={correct ? 'font-medium text-green-700' : 'font-medium text-red-700'}>{correct ? 'Correct' : 'Incorrect'}</p>
                  </li>
                ))}
              </ol>
              <button onClick={() => { setPreviewResult(null); setPreviewAnswers({}) }}
                className="mt-4 rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                Retake
              </button>
            </>
          ) : (
            <>
              <p className="mb-3 text-xs text-slate-400">A fresh 10-question sample — exactly what a student sees. Answer and submit to grade it.</p>
              <ol className="space-y-5">
                {preview.questions.map((q, i) => (
                  <li key={q.id} className="rounded-lg border border-slate-200 p-4">
                    <p className="font-medium text-slate-800">{i + 1}. {q.question}</p>
                    {q.code && <pre className="my-2 overflow-x-auto rounded bg-slate-900 p-2 text-xs text-slate-100">{q.code}</pre>}
                    {q.options.length > 0 ? (
                      <div className="mt-2 space-y-1">
                        {q.options.map((opt) => (
                          <label key={opt} className="flex items-center gap-2 text-sm text-slate-700">
                            <input type="radio" name={`pv-${q.id}`} value={opt}
                              checked={previewAnswers[q.id] === opt}
                              onChange={() => setPreviewAnswers((a) => ({ ...a, [q.id]: opt }))} />
                            {opt}
                          </label>
                        ))}
                      </div>
                    ) : (
                      <input type="text" className="mt-2 w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
                        value={previewAnswers[q.id] ?? ''}
                        onChange={(e) => setPreviewAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                        placeholder="Your answer" />
                    )}
                  </li>
                ))}
              </ol>
              <button onClick={submitPreview}
                className="mt-4 rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">
                Submit
              </button>
            </>
          )}
        </div>
      )}

      {/* Results */}
      <h2 className="mb-3 text-lg font-semibold text-slate-800">My students’ quizzes</h2>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Student</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Lesson</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Status</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Score</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Assigned</th>
              <th className="px-4 py-3 text-left font-medium text-slate-600">Parent note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(myStudents ?? []).map((r) => {
              const completed = r.status === 'completed'
              return (
              <tr key={r.quizId} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-800">{r.studentName} <span className="text-slate-400">({r.githubUsername ?? '—'})</span></td>
                <td className="px-4 py-3 text-slate-700">{r.lessonName}</td>
                <td className="px-4 py-3 text-slate-600">
                  {completed && !r.parentNoteSentAt
                    ? <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Awaiting review</span>
                    : r.status}
                </td>
                <td className="px-4 py-3">
                  {r.score == null ? <span className="text-slate-400">—</span> : (
                    <span className={r.passed ? 'text-green-700' : 'text-red-700'}>{r.score}% {r.passed ? '✓' : '✗'}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-600">{new Date(r.createdAt).toLocaleDateString()}</td>
                <td className="px-4 py-3">
                  {completed ? (
                    <button onClick={() => openReview(r.quizId)} disabled={reviewBusy}
                      className="rounded border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                      {r.parentNoteSentAt ? 'Review / re-send' : 'Review & send'}
                    </button>
                  ) : (
                    <span className="text-xs text-slate-400">—</span>
                  )}
                </td>
              </tr>
              )
            })}
            {(myStudents ?? []).length === 0 && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">No quizzes assigned yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Parent-note review panel */}
      {review && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
          <div className="my-8 w-full max-w-2xl rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-800">
                Review — {review.studentName} · {review.lessonName}
              </h2>
              <button onClick={() => setReview(null)} className="text-sm text-slate-500 hover:underline">Close</button>
            </div>

            <div className={`mb-4 rounded-lg p-3 ${review.passed ? 'bg-green-50' : 'bg-red-50'}`}>
              <span className="text-2xl font-bold">{review.score}%</span>{' '}
              <span className={review.passed ? 'text-green-700' : 'text-red-700'}>
                {review.passed ? 'Passed' : 'Not passed'}
              </span>
            </div>

            <ol className="mb-4 max-h-64 space-y-2 overflow-y-auto">
              {review.results.map((r, i) => (
                <li key={r.questionId} className="rounded border border-slate-200 p-2 text-sm">
                  <p className="text-slate-600">
                    Q{i + 1} — answer: {r.studentAnswer || <em className="text-slate-400">blank</em>}
                  </p>
                  <p className={r.correct ? 'font-medium text-green-700' : 'font-medium text-red-700'}>
                    {r.correct ? 'Correct' : `Incorrect (correct: ${r.correctAnswer})`}
                  </p>
                </li>
              ))}
            </ol>

            <label className="mb-1 block text-sm font-medium text-slate-700">
              Note to parent {review.parentEmail ? <span className="font-normal text-slate-400">→ {review.parentEmail}</span> : null}
            </label>
            <textarea
              value={reviewNote}
              onChange={(e) => setReviewNote(e.target.value)}
              rows={4}
              placeholder="Add a short note about how the student did…"
              className="mb-2 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />

            {!review.parentEmail && (
              <p className="mb-2 text-sm text-amber-700">
                No parent email on file for this student. It syncs from the student’s Pike13 account —
                make sure their Pike13 profile has a guardian email, then re-sync.
              </p>
            )}
            {reviewErr && <p className="mb-2 text-sm text-red-600">{reviewErr}</p>}
            {review.parentNoteSentAt && (
              <p className="mb-2 text-sm text-slate-500">
                Last sent {new Date(review.parentNoteSentAt).toLocaleString()}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button onClick={() => setReview(null)}
                className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
                Cancel
              </button>
              <button onClick={sendParentNote} disabled={!review.parentEmail || sending}
                className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                {sending ? 'Sending…' : review.parentNoteSentAt ? 'Re-send to parent' : 'Send to parent'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
