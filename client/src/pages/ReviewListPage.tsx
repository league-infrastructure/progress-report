import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSearch, useLocation } from 'wouter'
import { MonthPicker } from '../components/MonthPicker'
import { Plus } from 'lucide-react'
import { getDefaultMonth } from '../lib/utils'
import type { ReviewDto } from '../types/review'

interface StudentDto {
  id: number
  name: string
  githubUsername: string | null
  attendanceDates: string[]
}

async function fetchReviews(month: string): Promise<ReviewDto[]> {
  const res = await fetch(`/api/reviews?month=${encodeURIComponent(month)}`)
  if (!res.ok) throw new Error('Failed to load reviews')
  return res.json()
}

async function fetchStudents(month: string): Promise<StudentDto[]> {
  const res = await fetch(`/api/instructor/students?month=${encodeURIComponent(month)}`)
  if (!res.ok) throw new Error('Failed to load students')
  return res.json()
}

async function createReview(studentId: number, month: string): Promise<ReviewDto> {
  const res = await fetch('/api/reviews', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId, month }),
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

function formatAttendance(dates: string[]): string {
  return dates
    .map((d) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))
    .join(', ')
}

export function ReviewListPage() {
  const search = useSearch()
  const [, setLocation] = useLocation()
  const params = new URLSearchParams(search)
  const month = params.get('month') ?? getDefaultMonth()
  const queryClient = useQueryClient()

  const { data: reviews = [], isLoading: reviewsLoading } = useQuery<ReviewDto[]>({
    queryKey: ['reviews', month],
    queryFn: () => fetchReviews(month),
  })

  const { data: students = [], isLoading: studentsLoading } = useQuery<StudentDto[]>({
    queryKey: ['instructor-students', month],
    queryFn: () => fetchStudents(month),
  })

  const createMutation = useMutation({
    mutationFn: ({ studentId }: { studentId: number }) => createReview(studentId, month),
    onSuccess: (review) => {
      queryClient.invalidateQueries({ queryKey: ['reviews', month] })
      setLocation(`/reviews/${review.id}`)
    },
  })

  const reviewedStudentIds = new Set(reviews.map((r) => r.studentId))
  const unreviewed = students.filter((s) => !reviewedStudentIds.has(s.id))
  const isLoading = reviewsLoading || studentsLoading

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Instructor</div>
          <h2>Reviews</h2>
        </div>
        <div className="actions">
          <MonthPicker />
        </div>
      </div>

      {isLoading && <p style={{ color: 'var(--color-muted)' }}>Loading…</p>}

      {!isLoading && students.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: '32px' }}>
          <p style={{ fontWeight: 600, marginBottom: 4, color: 'var(--color-ink)' }}>No students assigned yet.</p>
          <p className="muted">Students are synced from Pike13. Try logging out and back in to trigger a sync.</p>
        </div>
      )}

      {reviews.length > 0 && (
        <div className="card card-table" style={{ marginBottom: 20 }}>
          <div className="card-table-head">
            <h3>This Month</h3>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Student</th>
                <th>Attendance</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {reviews.map((r) => {
                const studentInfo = students.find((s) => s.id === r.studentId)
                return (
                  <tr
                    key={r.id}
                    className="hover-row"
                    onClick={() => setLocation(`/reviews/${r.id}`)}
                  >
                    <td><span className="name">{r.studentName}</span></td>
                    <td className="muted">
                      {studentInfo && studentInfo.attendanceDates.length > 0
                        ? formatAttendance(studentInfo.attendanceDates)
                        : '—'}
                    </td>
                    <td><StatusBadge status={r.status} /></td>
                    <td style={{ textAlign: 'right', color: 'var(--color-muted)' }}>›</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {unreviewed.length > 0 && (
        <div className="card card-table">
          <div className="card-table-head">
            <h3>Start a Review</h3>
            <div className="muted">{unreviewed.length} student{unreviewed.length !== 1 ? 's' : ''} without a review this month</div>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Student</th>
                <th>GitHub</th>
                <th>Attendance</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {unreviewed.map((s) => (
                <tr key={s.id}>
                  <td><span className="name">{s.name}</span></td>
                  <td className="muted">
                    {s.githubUsername
                      ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>@{s.githubUsername}</span>
                      : '—'}
                  </td>
                  <td className="muted">
                    {s.attendanceDates.length > 0 ? formatAttendance(s.attendanceDates) : '—'}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      className="btn primary sm"
                      onClick={() => createMutation.mutate({ studentId: s.id })}
                      disabled={createMutation.isPending}
                    >
                      <Plus size={13} /> Write Review
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
