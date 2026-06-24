export function LoginPage() {
  const params = new URLSearchParams(window.location.search)
  const denied = params.get('error') === 'denied'

  return (
    <div className="login-screen">
      <div className="login-card">
        <img src="/league_logo.png" className="login-logo" alt="The LEAGUE of Amazing Programmers" />
        <h1>The LEAGUE of Amazing Programmers</h1>
        <p style={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: 12.5, fontWeight: 600, color: 'var(--color-muted)' }}>
          Classroom Management Platform
        </p>

        {denied && (
          <p style={{
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 8,
            padding: '10px 14px',
            fontSize: 13,
            color: 'var(--color-danger)',
            marginBottom: 16,
          }}>
            Access denied. Only @jointheleague.org accounts can log in.
          </p>
        )}

        {/* Instructors & Admins — Pike13 */}
        <div style={{ textAlign: 'left', marginBottom: 8 }}>
          <h5 style={{ margin: '0 0 6px', color: 'var(--color-text-muted, #64748b)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Instructors &amp; Admins
          </h5>
          <a href="/api/auth/pike13" className="btn primary lg" style={{ width: '100%' }}>
            Sign in with Pike13
          </a>
          <div className="legal">Only <code>@jointheleague.org</code> accounts are accepted.</div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '18px 0', color: '#94a3b8', fontSize: 12 }}>
          <span style={{ flex: 1, height: 1, background: '#e2e8f0' }} />
          OR
          <span style={{ flex: 1, height: 1, background: '#e2e8f0' }} />
        </div>

        {/* Students — GitHub */}
        <div style={{ textAlign: 'left' }}>
          <h5 style={{ margin: '0 0 6px', color: 'var(--color-text-muted, #64748b)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Students
          </h5>
          <a
            href="/api/auth/github"
            className="btn lg"
            style={{ width: '100%', background: '#24292f', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            Sign in with GitHub
          </a>
          <div className="legal">Sign in with GitHub to take your assigned quizzes.</div>
        </div>

        {/* Placement test — prospective students */}
        <div style={{ marginTop: 20, fontSize: 12.5 }}>
          New to the League?{' '}
          <a href="/placement" style={{ color: 'var(--color-primary, #2563eb)', textDecoration: 'underline' }}>
            Take the Python placement test
          </a>
        </div>
      </div>
    </div>
  )
}
