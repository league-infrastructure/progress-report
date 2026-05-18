import { Link, useLocation } from 'wouter'
import { useAuth } from '../hooks/useAuth'
import { BarChart, Users, Shield, MessageSquare, Heart, Bell, Home, UserCog } from 'lucide-react'

const ADMIN_LINKS = [
  { href: '/admin',                  label: 'Overview',    Icon: BarChart },
  { href: '/admin/instructors',      label: 'Instructors', Icon: Users },
  { href: '/admin/compliance',       label: 'Compliance',  Icon: Shield },
  { href: '/admin/volunteer-hours',  label: 'Volunteers',  Icon: Heart },
  { href: '/admin/feedback',         label: 'Feedback',    Icon: MessageSquare },
  { href: '/admin/users',            label: 'Admin Users', Icon: UserCog },
]

function getInitials(name: string): string {
  return name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2)
}

interface AdminLayoutProps {
  children: React.ReactNode
}

export function AdminLayout({ children }: AdminLayoutProps) {
  const [location] = useLocation()
  const { user } = useAuth()
  const initials = user?.name ? getInitials(user.name) : '?'

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">L</div>
          <div>
            <div className="brand-name">League Review Tool</div>
            <div className="brand-sub">Admin portal</div>
          </div>
        </div>

        <div className="side-section">
          <h5>Admin</h5>
          {ADMIN_LINKS.map(({ href, label, Icon }) => {
            const isActive = location === href
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

        <div className="side-section" style={{ marginTop: 'auto' }}>
          <h5>Instructor</h5>
          <Link
            href="/dashboard"
            className="nav-item"
            aria-current={location === '/dashboard' ? 'page' : undefined}
          >
            <Home className="nav-ico" />
            My Dashboard
          </Link>
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <div className="spacer" />
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
