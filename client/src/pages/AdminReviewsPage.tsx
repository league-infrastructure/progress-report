import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSearch, useLocation } from 'wouter'
import { MonthPicker } from '../components/MonthPicker'
import { Plus, Search } from 'lucide-react'
import type { ReviewDto } from '../types/review'

interface AdminStudentDto {
  id: number
  name: string
  githubUsername: string | null
  instructorId: number | null
  instructorName: string | null
}

function getCurrentMonth(): string {
  return new Date().toISOString().slice(0, 7)
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
  const month = params.get('month') ?? getCurrentMonth()
  const queryClient = useQueryClient()
  const [query, setQuery] = useState('')

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

  const reviewMap = new Map(reviews.map((r) => [r.studentId, r]))

  const filtered = query.trim()
    ? allStudents.filter((s) => s.name.toLowerCase().includes(query.trim().toLowerCase()))
    : allStudents

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
          placeholder="Search students…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ paddingLeft: 32 }}
          autoFocus
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
            <h3>All Students</h3>
            <div className="muted">{filtered.length} student{filtered.length !== 1 ? 's' : ''}</div>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Student</th>
                <th>GitHub</th>
                <th>Instructor</th>
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
                    <td className="muted">{s.instructorName ?? <span style={{ color: 'var(--color-danger)' }}>Unassigned</span>}</td>
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
