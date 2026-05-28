export function LoginPage() {
  const params = new URLSearchParams(window.location.search)
  const denied = params.get('error') === 'denied'

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="brand-mark" style={{ margin: '0 auto 14px' }}>L</div>
        <h1>The LEAGUE's Progress Report Tool</h1>
        <p>Monthly student reviews, TA check-ins, and guardian feedback — all in one place.</p>
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
        <a href="/api/auth/pike13" className="btn primary lg">
          Sign in with Pike13
        </a>
        <div className="legal">Only <code>@jointheleague.org</code> accounts are accepted.</div>
      </div>
    </div>
  )
}
