import { useState, useMemo, Fragment } from 'react'
import { useQuery } from '@tanstack/react-query'

interface AttemptRow {
  attemptId: number
  quizId: number
  studentId: number
  studentName: string
  githubUsername: string | null
  lessonName: string
  levelId: number
  score: number
  passed: boolean
  answers: Record<string, string>
  submittedAt: string
  questionIds: string[]
  bypassReason: string | null
}

async function fetchAttempts(from: string, to: string): Promise<AttemptRow[]> {
  const params = new URLSearchParams()
  if (from) params.set('from', new Date(from).toISOString())
  if (to) {
    // include the whole "to" day
    const end = new Date(to)
    end.setHours(23, 59, 59, 999)
    params.set('to', end.toISOString())
  }
  const res = await fetch(`/api/quiz/admin/attempts?${params.toString()}`)
  if (!res.ok) throw new Error('Failed to load quiz attempts')
  return res.json()
}

export function AdminPastQuizzesPage() {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [filter, setFilter] = useState('')
  const [expanded, setExpanded] = useState<number | null>(null)

  const { data, isLoading, error } = useQuery<AttemptRow[]>({
    queryKey: ['quiz', 'admin', 'attempts', from, to],
    queryFn: () => fetchAttempts(from, to),
  })

  const rows = useMemo(() => {
    const all = data ?? []
    const q = filter.trim().toLowerCase()
    if (!q) return all
    return all.filter(
      (r) =>
        r.studentName.toLowerCase().includes(q) ||
        (r.githubUsername ?? '').toLowerCase().includes(q) ||
        r.lessonName.toLowerCase().includes(q),
    )
  }, [data, filter])

  const thClass = 'px-4 py-3 text-left font-medium text-slate-600 whitespace-nowrap'

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Past Quizzes</h1>
        <p className="text-slate-500">Every completed quiz attempt, with score, pass/fail, and answers.</p>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-sm text-slate-600">
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="ml-2 rounded border border-slate-300 px-2 py-1" />
        </label>
        <label className="text-sm text-slate-600">
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="ml-2 rounded border border-slate-300 px-2 py-1" />
        </label>
        <input
          type="text"
          placeholder="Filter by student, GitHub, or lesson…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="flex-1 min-w-[220px] rounded border border-slate-300 px-3 py-1.5 text-sm"
        />
      </div>

      {isLoading && <p className="text-slate-500">Loading…</p>}
      {error && <p className="text-red-600">Failed to load quiz attempts.</p>}
      {!isLoading && !error && rows.length === 0 && (
        <p className="text-slate-500">No quiz attempts found for this range.</p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className={thClass}>Student</th>
                <th className={thClass}>GitHub</th>
                <th className={thClass}>Lesson</th>
                <th className={thClass}>Score</th>
                <th className={thClass}>Result</th>
                <th className={thClass}>Submitted</th>
                <th className={thClass}></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <Fragment key={r.attemptId}>
                  <tr className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">{r.studentName}</td>
                    <td className="px-4 py-3 text-slate-600">{r.githubUsername ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-700">{r.lessonName}</td>
                    <td className="px-4 py-3 text-slate-700">{r.score}%</td>
                    <td className="px-4 py-3">
                      {r.passed ? (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Pass</span>
                      ) : (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Fail</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{new Date(r.submittedAt).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <button
                        className="text-blue-600 hover:underline"
                        onClick={() => setExpanded(expanded === r.attemptId ? null : r.attemptId)}
                      >
                        {expanded === r.attemptId ? 'Hide' : 'Details'}
                      </button>
                    </td>
                  </tr>
                  {expanded === r.attemptId && (
                    <tr className="bg-slate-50">
                      <td colSpan={7} className="px-4 py-3">
                        {r.bypassReason && (
                          <p className="mb-2 text-xs text-amber-700">Completion gate bypassed: {r.bypassReason}</p>
                        )}
                        <table className="min-w-full text-xs">
                          <tbody>
                            {r.questionIds.map((qid, i) => (
                              <tr key={qid} className="border-b border-slate-100">
                                <td className="py-1 pr-4 text-slate-400">{i + 1}</td>
                                <td className="py-1 pr-4 font-mono text-slate-500">{qid}</td>
                                <td className="py-1 text-slate-700">{r.answers[qid] ?? <em className="text-slate-400">no answer</em>}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
