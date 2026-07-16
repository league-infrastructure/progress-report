import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'wouter'
import { AlertTriangle } from 'lucide-react'

export interface InstructorNotification {
  id: number
  kind: string
  studentId: number | null
  studentName: string | null
  weekOf: string | null
  message: string
  createdAt: string
}

async function fetchNotifications(): Promise<InstructorNotification[]> {
  const res = await fetch('/api/instructor/notifications')
  if (!res.ok) throw new Error('Failed to load notifications')
  return res.json()
}

export function CommitNotifications() {
  const queryClient = useQueryClient()
  const [, setLocation] = useLocation()
  const [busyId, setBusyId] = useState<number | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const { data: notifications = [] } = useQuery<InstructorNotification[]>({
    queryKey: ['instructor', 'notifications'],
    queryFn: fetchNotifications,
  })

  const acknowledge = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/instructor/notifications/${id}/acknowledge`, { method: 'POST' })
      if (!res.ok) throw new Error('Failed to acknowledge')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['instructor', 'notifications'] }),
  })

  const draftParentNote = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/instructor/notifications/${id}/parent-note`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { error?: string }).error ?? 'Failed to draft parent note')
      }
      return res.json() as Promise<{ reviewId: number }>
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['instructor', 'notifications'] })
      queryClient.invalidateQueries({ queryKey: ['reviews'] })
      // Open the review with the drafted note for the instructor to edit and send.
      setLocation(`/reviews/${data.reviewId}`)
    },
    onError: (e) => setErrorMsg((e as Error).message),
  })

  if (notifications.length === 0) return null

  return (
    <div style={{ marginBottom: 16, borderRadius: 8, padding: '12px 14px', background: '#fffbeb', border: '1px solid #fde68a' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, color: '#92400e', fontWeight: 600 }}>
        <AlertTriangle size={16} /> Attention needed
      </div>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {notifications.map((n) => (
          <li key={n.id} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, padding: '6px 0', borderTop: '1px solid #fde68a', fontSize: 13, color: '#78350f' }}>
            <span style={{ flex: 1, minWidth: 200 }}>{n.message}</span>
            {n.kind === 'no_commit' && n.studentId && (
              <button
                className="btn ghost"
                style={{ padding: '2px 8px', fontSize: 12 }}
                disabled={draftParentNote.isPending && busyId === n.id}
                onClick={() => {
                  const ok = window.confirm(
                    `Notify ${n.studentName ?? 'this student'}'s parent about the missing work?\n\n` +
                    `This drafts a note and opens it in the review editor for you to review and send. ` +
                    `Nothing is sent to the parent automatically.`,
                  )
                  if (ok) { setBusyId(n.id); setErrorMsg(null); draftParentNote.mutate(n.id) }
                }}
              >
                {draftParentNote.isPending && busyId === n.id ? 'Drafting…' : 'Draft parent note'}
              </button>
            )}
            <button
              className="btn ghost"
              style={{ padding: '2px 8px', fontSize: 12 }}
              disabled={acknowledge.isPending}
              onClick={() => acknowledge.mutate(n.id)}
            >
              Acknowledge
            </button>
          </li>
        ))}
      </ul>
      {errorMsg && <p style={{ margin: '8px 0 0', color: 'var(--color-danger)', fontSize: 13 }}>{errorMsg}</p>}
    </div>
  )
}
