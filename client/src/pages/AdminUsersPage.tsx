import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../hooks/useAuth'

interface AdminUserDto {
  email: string
  createdAt: string
}

async function fetchAdminUsers(): Promise<AdminUserDto[]> {
  const res = await fetch('/api/admin/users')
  if (!res.ok) throw new Error('Failed to load admin users')
  return res.json()
}

async function addAdminUser(email: string): Promise<void> {
  const res = await fetch('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  if (res.status === 409) throw new Error('Already an admin')
  if (!res.ok) throw new Error('Failed to add admin user')
}

async function removeAdminUser(email: string): Promise<void> {
  const res = await fetch(`/api/admin/users/${encodeURIComponent(email)}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error('Failed to remove admin user')
}

export function AdminUsersPage() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  const [addEmail, setAddEmail] = useState('')
  const [addError, setAddError] = useState<string | null>(null)

  const { data: adminUsers = [], isLoading, error } = useQuery<AdminUserDto[]>({
    queryKey: ['admin', 'users'],
    queryFn: fetchAdminUsers,
  })

  const addMutation = useMutation({
    mutationFn: (email: string) => addAdminUser(email),
    onSuccess: () => {
      setAddEmail('')
      setAddError(null)
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
    },
    onError: (err: Error) => {
      setAddError(err.message)
    },
  })

  const removeMutation = useMutation({
    mutationFn: (email: string) => removeAdminUser(email),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
    },
  })

  function handleRemove(email: string) {
    if (!window.confirm(`Remove ${email} from admin users?`)) return
    removeMutation.mutate(email)
  }

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setAddError(null)
    if (!addEmail.trim()) return
    addMutation.mutate(addEmail.trim())
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Admin</div>
          <h2>Admin users</h2>
        </div>
      </div>

      <div className="card card-table" style={{ marginBottom: 24 }}>
        <div className="card-table-head">
          <h3 style={{ margin: 0 }}>Admin accounts</h3>
        </div>

        {isLoading && (
          <p style={{ padding: '16px 18px', color: 'var(--color-muted)', fontSize: 14 }}>Loading…</p>
        )}
        {error && (
          <p style={{ padding: '16px 18px', color: 'var(--color-danger)', fontSize: 14 }}>
            Failed to load admin users.
          </p>
        )}
        {!isLoading && adminUsers.length === 0 && !error && (
          <p style={{ padding: '16px 18px', color: 'var(--color-muted)', fontSize: 14 }}>No admin users found.</p>
        )}

        {adminUsers.length > 0 && (
          <table className="tbl">
            <thead>
              <tr>
                <th>Email</th>
                <th>Added</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {adminUsers.map((u) => (
                <tr key={u.email}>
                  <td style={{ fontWeight: 600, fontSize: 13 }}>{u.email}</td>
                  <td style={{ color: 'var(--color-muted)', fontSize: 13 }}>
                    {new Date(u.createdAt).toLocaleDateString()}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {u.email !== user?.email && (
                      <button
                        className="btn outline sm"
                        onClick={() => handleRemove(u.email)}
                        disabled={removeMutation.isPending}
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card" style={{ maxWidth: 480 }}>
        <h3>Add admin</h3>
        <div className="divider" />
        <form onSubmit={handleAdd}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <input
              type="email"
              className="input"
              placeholder="user@example.com"
              value={addEmail}
              onChange={(e) => setAddEmail(e.target.value)}
              style={{ flex: 1 }}
            />
            <button
              type="submit"
              className="btn primary"
              disabled={addMutation.isPending || !addEmail.trim()}
            >
              {addMutation.isPending ? 'Adding…' : 'Add admin'}
            </button>
          </div>
          {addError && (
            <p style={{ marginTop: 8, fontSize: 13, color: 'var(--color-danger)' }}>{addError}</p>
          )}
        </form>
      </div>
    </div>
  )
}
