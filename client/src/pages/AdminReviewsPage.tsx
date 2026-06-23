import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSearch, useLocation } from 'wouter'
import { MonthPicker } from '../components/MonthPicker'
import { Plus, Search } from 'lucide-react'
import { getDefaultMonth } from '../lib/utils'
import type { ReviewDto } from '../types/review'

interface AdminStudentDto {
  id: number
  name: string
  githubUsername: string | null
  instructorId: number | null
  instructorName: string | null
}

async function fetchAllStudents(): Promise<AdminStudentDto[]> {
  const res = await fetch('/api/admin/students')
  if (!res.ok) throw new Error('Failed to load students')
  return res.json()
}

async function fetchAdminReviews(month: string): Promise<ReviewDto[]> {
  const res = await fetch(`/api/admin/reviews?month=${encodeURIComponent(month)}`)
  if (!res.ok) throw new Error('Failed to load reviews')
  return res.json()
}

async function createAdminReview(studentId: number, instructorId: number, month: string): Promise<ReviewDto> {
  const res = await fetch('/api/admin/reviews', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId, instructorId, month }),
  })
  if (!res.ok) throw new Error('Failed to create review')
  return res.json()
}

function StatusBadge({ status }: { status: string }) {
  const label = status.charAt(0).toUpperCase() + status.slice(1)
  return (
    <span className={`badge ${status}`}>
      <span className="dot" />
      {label}
    </span>
  )
}

export function AdminReviewsPage() {
  const search = useSearch()
  const [, setLocation] = useLocation()
  const params = new URLSearchParams(search)
  const month = params.get('month') ?? getDefaultMonth()
  const queryClient = useQueryClient()
  const [query, setQuery] = useState('')
  const [selectedInstructorId, setSelectedInstructorId] = useState<number | null>(null)

  const { data: allStudents = [], isLoading: studentsLoading } = useQuery<AdminStudentDto[]>({
    queryKey: ['admin-students'],
    queryFn: fetchAllStudents,
  })

  const { data: reviews = [], isLoading: reviewsLoading } = useQuery<ReviewDto[]>({
    queryKey: ['admin-reviews', month],
    queryFn: () => fetchAdminReviews(month),
  })

  const createMutation = useMutation({
    mutationFn: ({ studentId, instructorId }: { studentId: number; instructorId: number }) =>
      createAdminReview(studentId, instructorId, month),
    onSuccess: (review) => {
      queryClient.invalidateQueries({ queryKey: ['admin-reviews', month] })
      setLocation(`/admin/reviews/${review.id}`)
    },
  })

  const reviewMap = useMemo(() => new Map(reviews.map((r) => [r.studentId, r])), [reviews])

  // Build instructor list and per-instructor counts from allStudents + reviewMap
  const instructorStats = useMemo(() => {
    const map = new Map<number, { name: string; sent: number; draft: number; pending: number; total: number }>()
    for (const s of allStudents) {
      if (!s.instructorId || !s.instructorName) continue
      if (!map.has(s.instructorId)) {
        map.set(s.instructorId, { name: s.instructorName, sent: 0, draft: 0, pending: 0, total: 0 })
      }
      const entry = map.get(s.instructorId)!
      entry.total++
      const review = reviewMap.get(s.id)
      if (!review || review.status === 'pending') entry.pending++
      else if (review.status === 'draft') entry.draft++
      else if (review.status === 'sent') entry.sent++
    }
    return [...map.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name))
  }, [allStudents, reviewMap])

  const byInstructor = selectedInstructorId !== null
    ? allStudents.filter((s) => s.instructorId === selectedInstructorId)
    : allStudents

  const filtered = query.trim()
    ? byInstructor.filter((s) => s.name.toLowerCase().includes(query.trim().toLowerCase()))
    : byInstructor

  const selectedStats = selectedInstructorId !== null
    ? instructorStats.find(([id]) => id === selectedInstructorId)?.[1]
    : null

  const isLoading = studentsLoading || reviewsLoading

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Admin</div>
          <h2>Student Reviews</h2>
        </div>
        <div className="actions">
          <MonthPicker />
        </div>
      </div>

      {/* Instructor filter pills */}
      {!isLoading && instructorStats.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          <button
            className={selectedInstructorId === null ? 'btn primary sm' : 'btn outline sm'}
            onClick={() => setSelectedInstructorId(null)}
          >
            All instructors
          </button>
          {instructorStats.map(([id, stats]) => (
            <button
              key={id}
              className={selectedInstructorId === id ? 'btn primary sm' : 'btn outline sm'}
              onClick={() => setSelectedInstructorId(selectedInstructorId === id ? null : id)}
            >
              {stats.name}
              <span style={{
                marginLeft: 6,
                padding: '1px 6px',
                borderRadius: 10,
                fontSize: 11,
                background: selectedInstructorId === id ? 'rgba(255,255,255,0.25)' : 'var(--slate-100)',
                color: selectedInstructorId === id ? 'inherit' : 'var(--color-muted)',
                fontWeight: 600,
              }}>
                {stats.sent}/{stats.total}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Per-instructor summary bar */}
      {selectedStats && (
        <div style={{
          display: 'flex',
          gap: 20,
          marginBottom: 16,
          padding: '10px 14px',
          borderRadius: 8,
          background: 'var(--slate-50)',
          border: '1px solid var(--slate-200)',
          fontSize: 13,
        }}>
          <span><strong>{selectedStats.total}</strong> <span style={{ color: 'var(--color-muted)' }}>total</span></span>
          <span style={{ color: 'var(--color-success)' }}><strong>{selectedStats.sent}</strong> sent</span>
          <span style={{ color: 'var(--color-warning, #d97706)' }}><strong>{selectedStats.draft}</strong> draft</span>
          <span style={{ color: 'var(--color-muted)' }}><strong>{selectedStats.pending}</strong> pending</span>
        </div>
      )}

      <div style={{ marginBottom: 16, position: 'relative' }}>
        <Search
          size={15}
          style={{
            position: 'absolute',
            left: 10,
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--color-muted)',
            pointerEvents: 'none',
          }}
        />
        <input
          className="input"
          placeholder={selectedInstructorId !== null ? 'Search students…' : 'Search students…'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ paddingLeft: 32 }}
        />
      </div>

      {isLoading && <p style={{ color: 'var(--color-muted)' }}>Loading…</p>}

      {!isLoading && filtered.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: '32px' }}>
          <p style={{ fontWeight: 600, color: 'var(--color-ink)' }}>
            {query ? `No students match "${query}"` : 'No students found.'}
          </p>
        </div>
      )}

      {!isLoading && filtered.length > 0 && (
        <div className="card card-table">
          <div className="card-table-head">
            <h3>{selectedInstructorId !== null ? `${selectedStats?.name}'s Students` : 'All Students'}</h3>
            <div className="muted">{filtered.length} student{filtered.length !== 1 ? 's' : ''}</div>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Student</th>
                <th>GitHub</th>
                {selectedInstructorId === null && <th>Instructor</th>}
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const review = reviewMap.get(s.id)
                return (
                  <tr
                    key={s.id}
                    className={review ? 'hover-row' : undefined}
                    onClick={review ? () => setLocation(`/admin/reviews/${review.id}`) : undefined}
                    style={review ? { cursor: 'pointer' } : undefined}
                  >
                    <td><span className="name">{s.name}</span></td>
                    <td className="muted">
                      {s.githubUsername
                        ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>@{s.githubUsername}</span>
                        : '—'}
                    </td>
                    {selectedInstructorId === null && (
                      <td className="muted">{s.instructorName ?? <span style={{ color: 'var(--color-danger)' }}>Unassigned</span>}</td>
                    )}
                    <td>
                      {review ? <StatusBadge status={review.status} /> : <span className="muted">—</span>}
                    </td>
                    <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                      {review ? (
                        <button
                          className="btn outline sm"
                          onClick={() => setLocation(`/admin/reviews/${review.id}`)}
                        >
                          Edit
                        </button>
                      ) : (
                        <button
                          className="btn primary sm"
                          disabled={!s.instructorId || createMutation.isPending}
                          title={!s.instructorId ? 'No instructor assigned' : undefined}
                          onClick={() => {
                            if (s.instructorId) createMutation.mutate({ studentId: s.id, instructorId: s.instructorId })
                          }}
                        >
                          <Plus size={13} /> Write Review
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
