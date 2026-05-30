import { useState } from 'react'
import { Link, useLocation } from 'wouter'
import { useAuth } from '../hooks/useAuth'
import { useQueryClient } from '@tanstack/react-query'
import { Home, FileText, LayoutTemplate, ClipboardCheck, RefreshCw, Bell, BarChart, LogOut, HelpCircle } from 'lucide-react'

const INSTRUCTOR_LINKS = [
  { href: '/dashboard', label: 'Dashboard', Icon: Home },
  { href: '/reviews',   label: 'Reviews',   Icon: FileText },
  { href: '/templates', label: 'Templates', Icon: LayoutTemplate },
  { href: '/checkin',   label: 'Check-in',  Icon: ClipboardCheck },
]

function getInitials(name: string): string {
  return name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2)
}

interface InstructorLayoutProps {
  children: React.ReactNode
}

export function InstructorLayout({ children }: InstructorLayoutProps) {
  const [location] = useLocation()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<{ ok: boolean; text: string } | null>(null)

  async function handleSync() {
    setSyncing(true)
    setSyncResult(null)
    try {
      const res = await fetch('/api/instructor/sync/pike13', { method: 'POST' })
      if (res.ok) {
        const data = await res.json() as { studentsUpserted?: number; assignmentsCreated?: number }
        setSyncResult({ ok: true, text: `Synced — ${data.studentsUpserted ?? 0} students` })
        queryClient.invalidateQueries({ queryKey: ['dashboard'] })
        queryClient.invalidateQueries({ queryKey: ['instructor'] })
        queryClient.invalidateQueries({ queryKey: ['instructor-students'] })
        queryClient.invalidateQueries({ queryKey: ['reviews'] })
      } else {
        const err = await res.json().catch(() => ({ error: 'Sync failed' })) as { error?: string }
        setSyncResult({ ok: false, text: err.error ?? 'Sync failed' })
      }
    } catch {
      setSyncResult({ ok: false, text: 'Network error' })
    } finally {
      setSyncing(false)
    }
  }

  const initials = user?.name ? getInitials(user.name) : '?'

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">L</div>
          <div>
            <div className="brand-name">Progress Report Tool</div>
            <div className="brand-sub">Instructor portal</div>
          </div>
        </div>

        {user?.isAdmin && (
          <div className="side-section">
            <h5>Admin</h5>
            <Link
              href="/admin"
              className="nav-item"
              aria-current={location.startsWith('/admin') ? 'page' : undefined}
            >
              <BarChart className="nav-ico" />
              Admin Panel
            </Link>
          </div>
        )}

        <div className="side-section">
          <h5>Instructor</h5>
          {INSTRUCTOR_LINKS.map(({ href, label, Icon }) => {
            const isActive = location === href || (href === '/reviews' && location.startsWith('/reviews'))
            return (
              <Link
                key={href}
                href={href}
                className="nav-item"
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon className="nav-ico" />
                {label}
              </Link>
            )
          })}
        </div>

        <div style={{ flex: 1 }} />

        <div className="side-section">
          <h5>Help</h5>
          <Link
            href="/about"
            className="nav-item"
            aria-current={location === '/about' ? 'page' : undefined}
          >
            <HelpCircle className="nav-ico" />
            About
          </Link>
        </div>

        <div className="side-section">
          <button
            className="nav-item"
            style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
            onClick={async () => {
              await fetch('/api/auth/logout', { method: 'POST' })
              window.location.href = '/'
            }}
          >
            <LogOut className="nav-ico" />
            Sign out
          </button>
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <div className="spacer" />
          {syncResult && (
            <small style={{ color: syncResult.ok ? 'var(--color-success)' : 'var(--color-danger)' }}>
              {syncResult.text}
            </small>
          )}
          <button className="btn ghost sm" onClick={handleSync} disabled={syncing} title="Sync Pike13 data">
            <RefreshCw size={14} className={syncing ? 'spin' : ''} />
            {syncing ? 'Syncing…' : 'Sync Pike13'}
          </button>
          <button className="btn ghost sm" title="Notifications">
            <Bell size={15} />
          </button>
          {user && (
            <div className="user-chip">
              <div className="avatar">{initials}</div>
              <span>{user.name}</span>
            </div>
          )}
        </div>
        {children}
      </div>
    </div>
  )
}
