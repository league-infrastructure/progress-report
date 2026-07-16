import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearch } from 'wouter'
import { MonthPicker } from '../components/MonthPicker'
import { Bell, RefreshCw } from 'lucide-react'
import { getDefaultMonth } from '../lib/utils'
import { CommitNotifications } from '../components/CommitNotifications'
import type { PendingCheckinResponse } from '../types/checkin'

interface DashboardData {
  month: string
  totalStudents: number
  pending: number
  draft: number
  sent: number
}

interface StudentRow {
  id: number
  name: string
  githubUsername: string | null
  assignedAt: string
}

async function fetchDashboard(month: string): Promise<DashboardData> {
  const res = await fetch(`/api/instructor/dashboard?month=${encodeURIComponent(month)}`)
  if (!res.ok) throw new Error('Failed to load dashboard')
  return res.json()
}

async function fetchStudents(): Promise<StudentRow[]> {
  const res = await fetch('/api/instructor/students')
  if (!res.ok) throw new Error('Failed to load students')
  return res.json()
}

async function fetchPendingCheckin(): Promise<PendingCheckinResponse> {
  const res = await fetch('/api/checkins/pending')
  if (!res.ok) throw new Error('Failed to load check-in status')
  return res.json()
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="card stat">
      <div className="lbl">{label}</div>
      <div className="num">{value}</div>
    </div>
  )
}

export function DashboardPage() {
  const search = useSearch()
  const params = new URLSearchParams(search)
  const month = params.get('month') ?? getDefaultMonth()
  const queryClient = useQueryClient()

  const [checkinDismissed, setCheckinDismissed] = useState(false)
  const [studentSortKey, setStudentSortKey] = useState<'name' | 'githubUsername'>('name')
  const [studentSortDir, setStudentSortDir] = useState<'asc' | 'desc'>('asc')
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function handleSync() {
    setSyncing(true)
    setSyncMsg(null)
    try {
      const res = await fetch('/api/instructor/sync/pike13', { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        setSyncMsg({ ok: true, text: `Sync complete — ${data.studentsUpserted ?? 0} students, ${data.assignmentsCreated ?? 0} assignments updated.` })
        queryClient.invalidateQueries({ queryKey: ['dashboard'] })
        queryClient.invalidateQueries({ queryKey: ['instructor'] })
        queryClient.invalidateQueries({ queryKey: ['instructor-students'] })
        queryClient.invalidateQueries({ queryKey: ['reviews'] })
      } else {
        const err = await res.json().catch(() => ({ error: 'Sync failed' }))
        setSyncMsg({ ok: false, text: err.error ?? 'Sync failed' })
      }
    } catch {
      setSyncMsg({ ok: false, text: 'Network error during sync' })
    } finally {
      setSyncing(false)
    }
  }

  const { data, isLoading, error } = useQuery<DashboardData>({
    queryKey: ['dashboard', month],
    queryFn: () => fetchDashboard(month),
  })

  const { data: studentList = [], isLoading: studentsLoading } = useQuery<StudentRow[]>({
    queryKey: ['instructor', 'students'],
    queryFn: fetchStudents,
  })

  const { data: checkinData } = useQuery<PendingCheckinResponse>({
    queryKey: ['checkins', 'pending'],
    queryFn: fetchPendingCheckin,
  })

  const sortedStudents = useMemo(() => {
    return [...studentList].sort((a, b) => {
      let cmp = 0
      if (studentSortKey === 'name') cmp = a.name.localeCompare(b.name)
      else if (studentSortKey === 'githubUsername') cmp = (a.githubUsername ?? '').localeCompare(b.githubUsername ?? '')
      return studentSortDir === 'asc' ? cmp : -cmp
    })
  }, [studentList, studentSortKey, studentSortDir])

  function handleStudentSort(key: 'name' | 'githubUsername') {
    if (key === studentSortKey) setStudentSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setStudentSortKey(key); setStudentSortDir('asc') }
  }

  const showCheckinBanner =
    !checkinDismissed &&
    checkinData !== undefined &&
    !checkinData.alreadySubmitted

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Instructor</div>
          <h2>Dashboard</h2>
        </div>
        <div className="actions">
          <MonthPicker />
          <button className="btn outline" onClick={handleSync} disabled={syncing}>
            <RefreshCw size={15} className={syncing ? 'spin' : ''} />
            {syncing ? 'Syncing…' : 'Sync Pike13'}
          </button>
          <Link href={`/reviews?month=${month}`} className="btn primary">
            View Reviews
          </Link>
        </div>
      </div>

      {syncMsg && (
        <p style={{
          marginBottom: 16,
          borderRadius: 8,
          padding: '10px 14px',
          fontSize: 13,
          background: syncMsg.ok ? '#f0fdf4' : '#fef2f2',
          color: syncMsg.ok ? 'var(--color-success)' : 'var(--color-danger)',
          border: `1px solid ${syncMsg.ok ? '#bbf7d0' : '#fecaca'}`,
        }}>
          {syncMsg.text}
        </p>
      )}

      <CommitNotifications />

      {showCheckinBanner && (
        <div className="checkin-banner">
          <Bell className="bell" />
          <div className="msg">
            <strong>TA check-in is due this week.</strong>{' '}
            Not yet submitted for {checkinData.weekOf}.{' '}
            <Link href="/checkin" style={{ color: 'var(--color-primary)', fontWeight: 600 }}>
              Submit now
            </Link>
          </div>
          <button className="btn sm outline" onClick={() => setCheckinDismissed(true)}>
            Dismiss
          </button>
        </div>
      )}

      {isLoading && <p style={{ color: 'var(--color-muted)' }}>Loading…</p>}
      {error && <p style={{ color: 'var(--color-danger)' }}>Failed to load dashboard.</p>}

      {data && (
        <div className="grid stats" style={{ marginBottom: 20 }}>
          <StatCard label="Total Students" value={data.totalStudents} />
          <StatCard label="Pending" value={data.pending} />
          <StatCard label="Draft" value={data.draft} />
          <StatCard label="Sent" value={data.sent} />
        </div>
      )}

      <div className="card card-table">
        <div className="card-table-head">
          <div>
            <h3>My Students</h3>
            {studentList.length > 0 && (
              <div className="muted">
                {studentList.length} student{studentList.length !== 1 ? 's' : ''} — click to open their review
              </div>
            )}
          </div>
        </div>

        {studentsLoading && <p style={{ padding: '16px 18px', color: 'var(--color-muted)', fontSize: 14 }}>Loading students…</p>}

        {!studentsLoading && studentList.length === 0 && (
          <p style={{ padding: '16px 18px', color: 'var(--color-muted)', fontSize: 14 }}>
            No students assigned yet. Run a Pike13 sync to import your roster.
          </p>
        )}

        {studentList.length > 0 && (
          <table className="tbl">
            <thead>
              <tr>
                <th
                  className="sortable"
                  onClick={() => handleStudentSort('name')}
                >
                  Name{' '}
                  {studentSortKey === 'name'
                    ? <span style={{ color: 'var(--color-primary)' }}>{studentSortDir === 'asc' ? '↑' : '↓'}</span>
                    : <span style={{ color: 'var(--slate-300)' }}>↕</span>}
                </th>
                <th
                  className="sortable"
                  onClick={() => handleStudentSort('githubUsername')}
                >
                  GitHub{' '}
                  {studentSortKey === 'githubUsername'
                    ? <span style={{ color: 'var(--color-primary)' }}>{studentSortDir === 'asc' ? '↑' : '↓'}</span>
                    : <span style={{ color: 'var(--slate-300)' }}>↕</span>}
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedStudents.map((s) => (
                <tr key={s.id}>
                  <td><span className="name">{s.name}</span></td>
                  <td className="muted">
                    {s.githubUsername ? (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>@{s.githubUsername}</span>
                    ) : (
                      <span style={{ color: 'var(--slate-300)' }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
