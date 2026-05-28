import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { MonthPicker } from '../components/MonthPicker'
import { useSearch } from 'wouter'
import { RefreshCw, Trash2 } from 'lucide-react'
import type { AdminNotificationDto, AdminSettingDto } from '../types/admin'
import type { Pike13StatusDto, Pike13SyncResultDto } from '../types/pike13'

interface AnalyticsDto {
  month: string
  totalSent: number
  needToSend: number
  totalFeedback: number
  monthFeedbackCount: number
  feedbackRate: number
  avgRating: number | null
  topSuggestions: Array<{ suggestion: string | null; count: number }>
}

function getCurrentMonth(): string {
  return new Date().toISOString().slice(0, 7)
}

async function fetchNotifications(unreadOnly = false): Promise<AdminNotificationDto[]> {
  const url = unreadOnly ? '/api/admin/notifications?unread=true' : '/api/admin/notifications'
  const res = await fetch(url)
  if (!res.ok) throw new Error('Failed to load notifications')
  return res.json()
}

async function markRead(id: number): Promise<void> {
  const res = await fetch(`/api/admin/notifications/${id}/read`, { method: 'PATCH' })
  if (!res.ok) throw new Error('Failed to mark notification as read')
}

async function fetchPike13Status(): Promise<Pike13StatusDto> {
  const res = await fetch('/api/admin/pike13/status')
  if (!res.ok) throw new Error('Failed to load Pike13 status')
  return res.json()
}

async function triggerPike13Sync(): Promise<Pike13SyncResultDto> {
  const res = await fetch('/api/admin/sync/pike13', { method: 'POST' })
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(data.error ?? 'Sync failed')
  }
  return res.json()
}

async function fetchAnalytics(month: string): Promise<AnalyticsDto> {
  const res = await fetch(`/api/admin/analytics?month=${encodeURIComponent(month)}`)
  if (!res.ok) throw new Error('Failed to load analytics')
  return res.json()
}

async function fetchAdmins(): Promise<AdminSettingDto[]> {
  const res = await fetch('/api/admin/admins')
  if (!res.ok) throw new Error('Failed to load admin list')
  return res.json()
}

async function grantAdmin(email: string): Promise<AdminSettingDto> {
  const res = await fetch('/api/admin/admins', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  const data = await res.json() as { error?: string }
  if (!res.ok) throw new Error(data.error ?? 'Failed to grant admin')
  return data as AdminSettingDto
}

async function revokeAdmin(id: number): Promise<void> {
  const res = await fetch(`/api/admin/admins/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to revoke admin')
}

function StatCard({ label, num, sub }: { label: string; num: string | number; sub?: string }) {
  return (
    <div className="card stat">
      <div className="lbl">{label}</div>
      <div className="num" style={typeof num === 'string' && num.length > 4 ? { fontSize: 20, marginTop: 4 } : undefined}>{num}</div>
      {sub && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

export function AdminDashboardPage() {
  const queryClient = useQueryClient()
  const search = useSearch()
  const params = new URLSearchParams(search)
  const month = params.get('month') ?? getCurrentMonth()

  const [showAllNotifications, setShowAllNotifications] = useState(false)
  const [newAdminEmail, setNewAdminEmail] = useState('')

  const { data: notifications = [], isLoading, error } = useQuery<AdminNotificationDto[]>({
    queryKey: ['admin', 'notifications'],
    queryFn: () => fetchNotifications(),
  })

  const { data: pike13Status } = useQuery<Pike13StatusDto>({
    queryKey: ['admin', 'pike13', 'status'],
    queryFn: fetchPike13Status,
  })

  const { data: analytics } = useQuery<AnalyticsDto>({
    queryKey: ['admin', 'analytics', month],
    queryFn: () => fetchAnalytics(month),
  })

  const unreadCount = notifications.filter((n) => !n.isRead).length

  const markReadMutation = useMutation({
    mutationFn: (id: number) => markRead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'notifications'] }),
  })

  const syncMutation = useMutation({
    mutationFn: triggerPike13Sync,
  })

  const { data: admins = [] } = useQuery<AdminSettingDto[]>({
    queryKey: ['admin', 'admins'],
    queryFn: fetchAdmins,
  })

  const grantAdminMutation = useMutation({
    mutationFn: (email: string) => grantAdmin(email),
    onSuccess: () => {
      setNewAdminEmail('')
      queryClient.invalidateQueries({ queryKey: ['admin', 'admins'] })
    },
  })

  const revokeAdminMutation = useMutation({
    mutationFn: (id: number) => revokeAdmin(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'admins'] }),
  })

  const visibleNotifications = showAllNotifications
    ? notifications
    : notifications.filter((n) => !n.isRead)

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Admin</div>
          <h2>Program overview</h2>
        </div>
        <div className="actions">
          {pike13Status?.connected && (
            <div className="pike-status">
              <span className="ok" /> Pike13 connected
            </div>
          )}
          {pike13Status?.connected && (
            <button
              className="btn outline"
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
            >
              <RefreshCw size={15} className={syncMutation.isPending ? 'spin' : ''} />
              {syncMutation.isPending ? 'Syncing…' : 'Sync now'}
            </button>
          )}
          {pike13Status && !pike13Status.connected && (
            <button
              className="btn outline"
              onClick={() => { window.location.href = '/api/admin/pike13/connect' }}
            >
              Connect Pike13
            </button>
          )}
          <MonthPicker />
        </div>
      </div>

      {syncMutation.isSuccess && syncMutation.data && (
        <p style={{ marginBottom: 16, fontSize: 13, color: 'var(--color-success)' }}>
          Synced: {syncMutation.data.studentsUpserted} students, {syncMutation.data.assignmentsCreated} assignments, {syncMutation.data.hoursCreated} hours
        </p>
      )}
      {syncMutation.isError && (
        <p style={{ marginBottom: 16, fontSize: 13, color: 'var(--color-danger)' }}>
          {(syncMutation.error as Error).message}
        </p>
      )}

      {analytics && (
        <div className="grid stats" style={{ marginBottom: 20 }}>
          <StatCard label="Sent this month" num={analytics.totalSent} />
          <StatCard
            label="Still need to send"
            num={analytics.needToSend}
          />
          <StatCard
            label="Feedback received"
            num={analytics.monthFeedbackCount}
            sub={`${analytics.feedbackRate}% response rate`}
          />
          <StatCard
            label="Avg rating"
            num={analytics.avgRating !== null ? `${analytics.avgRating} / 5` : '—'}
            sub={`${analytics.totalFeedback} total responses`}
          />
        </div>
      )}

      <div className="grid split-2-1">
        {/* Notifications panel */}
        <div className="card card-table">
          <div className="card-table-head">
            <div>
              <h3 style={{ margin: 0 }}>
                Notifications
                {unreadCount > 0 && (
                  <span style={{
                    marginLeft: 8,
                    background: 'var(--color-danger)',
                    color: '#fff',
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 700,
                    padding: '1px 7px',
                  }}>
                    {unreadCount}
                  </span>
                )}
              </h3>
            </div>
            {notifications.length > 0 && (
              <button
                className="btn ghost sm"
                onClick={() => setShowAllNotifications((v) => !v)}
              >
                {showAllNotifications ? 'Unread only' : `Show all (${notifications.length})`}
              </button>
            )}
          </div>

          {isLoading && <p style={{ padding: '16px 18px', color: 'var(--color-muted)', fontSize: 14 }}>Loading…</p>}
          {error && <p style={{ padding: '16px 18px', color: 'var(--color-danger)', fontSize: 14 }}>Failed to load notifications.</p>}
          {!isLoading && visibleNotifications.length === 0 && (
            <p style={{ padding: '16px 18px', color: 'var(--color-muted)', fontSize: 14 }}>No unread notifications.</p>
          )}

          {visibleNotifications.length > 0 && (
            <table className="tbl">
              <tbody>
                {visibleNotifications.map((n) => (
                  <tr key={n.id} style={{ opacity: n.isRead ? 0.6 : 1 }}>
                    <td>
                      <div style={{ fontWeight: 600, color: 'var(--color-ink)', fontSize: 13 }}>{n.fromUserName}</div>
                      <div style={{ color: 'var(--color-body)', fontSize: 13 }}>{n.message}</div>
                      <div style={{ color: 'var(--color-muted)', fontSize: 12, marginTop: 2 }}>
                        {new Date(n.createdAt).toLocaleDateString()}
                      </div>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {!n.isRead && (
                        <button
                          className="btn outline sm"
                          onClick={() => markReadMutation.mutate(n.id)}
                          disabled={markReadMutation.isPending}
                        >
                          Mark read
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {analytics && analytics.topSuggestions.length > 0 && (
            <>
              <div style={{ padding: '12px 18px 4px', borderTop: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--color-muted)' }}>
                  Top Improvement Suggestions
                </div>
              </div>
              <table className="tbl">
                <tbody>
                  {analytics.topSuggestions.map((s, i) => (
                    <tr key={i}>
                      <td style={{ color: 'var(--color-body)' }}>{s.suggestion ?? '—'}</td>
                      <td style={{ textAlign: 'right' }}>
                        <span className="badge">{s.count}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>

        {/* Analytics breakdown */}
        {analytics && (
          <div className="card">
            <h3>Review analytics</h3>
            <div className="divider" />
            <div className="kv">
              <span className="k">Month</span>
              <span className="v">{analytics.month}</span>
            </div>
            <div className="kv">
              <span className="k">Sent</span>
              <span className="v" style={{ color: 'var(--color-success)' }}>{analytics.totalSent}</span>
            </div>
            <div className="kv">
              <span className="k">Need to send</span>
              <span className="v" style={{ color: analytics.needToSend > 0 ? 'var(--color-warning)' : 'var(--color-muted)' }}>
                {analytics.needToSend}
              </span>
            </div>
            <div className="kv">
              <span className="k">Feedback rate</span>
              <span className="v">{analytics.feedbackRate}%</span>
            </div>
            <div className="kv">
              <span className="k">Avg rating</span>
              <span className="v">{analytics.avgRating !== null ? `${analytics.avgRating} / 5` : '—'}</span>
            </div>
            <div className="kv">
              <span className="k">Total responses</span>
              <span className="v">{analytics.totalFeedback}</span>
            </div>
          </div>
        )}
      </div>

      {/* Admin user management */}
      <div className="card card-table" style={{ marginTop: 24 }}>
        <div className="card-table-head">
          <h3 style={{ margin: 0 }}>Admin access</h3>
        </div>

        <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)' }}>
          <form
            style={{ display: 'flex', gap: 8 }}
            onSubmit={(e) => {
              e.preventDefault()
              if (newAdminEmail.trim()) grantAdminMutation.mutate(newAdminEmail.trim())
            }}
          >
            <input
              type="email"
              className="input"
              placeholder="instructor@jointheleague.org"
              value={newAdminEmail}
              onChange={(e) => setNewAdminEmail(e.target.value)}
              style={{ flex: 1 }}
            />
            <button
              type="submit"
              className="btn primary"
              disabled={!newAdminEmail.trim() || grantAdminMutation.isPending}
            >
              Grant admin
            </button>
          </form>
          {grantAdminMutation.isError && (
            <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--color-danger)' }}>
              {(grantAdminMutation.error as Error).message}
            </p>
          )}
        </div>

        {admins.length === 0 ? (
          <p style={{ padding: '16px 18px', color: 'var(--color-muted)', fontSize: 14 }}>No admins configured.</p>
        ) : (
          <table className="tbl">
            <tbody>
              {admins.map((a) => (
                <tr key={a.id}>
                  <td style={{ fontSize: 14 }}>{a.email}</td>
                  <td style={{ color: 'var(--color-muted)', fontSize: 12 }}>
                    Added {new Date(a.createdAt).toLocaleDateString()}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      className="btn ghost sm"
                      onClick={() => revokeAdminMutation.mutate(a.id)}
                      disabled={revokeAdminMutation.isPending}
                      title="Revoke admin access"
                    >
                      <Trash2 size={14} />
                    </button>
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
