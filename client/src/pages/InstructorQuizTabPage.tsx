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
}

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Request failed: ${url}`)
  return res.json()
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

  const { data: roster, error: rosterError } = useQuery<Student[]>({
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
                    <option key={l.id} value={l.id}>{l.module} · {l.name}</option>
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
        </div>

        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
        {assignLink && (
          <div className="mt-3 rounded bg-green-50 p-3 text-sm">
            <p className="font-medium text-green-800">Quiz assigned. Share this link with the student:</p>
            <code className="break-all text-green-700">{assignLink}</code>
          </div>
        )}
      </div>

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
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(myStudents ?? []).map((r) => (
              <tr key={r.quizId} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-800">{r.studentName} <span className="text-slate-400">({r.githubUsername ?? '—'})</span></td>
                <td className="px-4 py-3 text-slate-700">{r.lessonName}</td>
                <td className="px-4 py-3 text-slate-600">{r.status}</td>
                <td className="px-4 py-3">
                  {r.score == null ? <span className="text-slate-400">—</span> : (
                    <span className={r.passed ? 'text-green-700' : 'text-red-700'}>{r.score}% {r.passed ? '✓' : '✗'}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-600">{new Date(r.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
            {(myStudents ?? []).length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-500">No quizzes assigned yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
