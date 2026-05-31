import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, useLocation } from 'wouter'
import { Mail, Save, Send, GitCommit } from 'lucide-react'
import type { ReviewDto } from '../types/review'
import type { TemplateDto } from '../types/template'

async function fetchReview(id: string): Promise<ReviewDto> {
  const res = await fetch(`/api/reviews/${id}`)
  if (!res.ok) throw new Error('Failed to load review')
  return res.json()
}

async function fetchTemplates(): Promise<TemplateDto[]> {
  const res = await fetch('/api/templates')
  if (!res.ok) throw new Error('Failed to load templates')
  return res.json()
}

function normalizePlaceholders(text: string): string {
  return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, key: string) => {
    const parts = key.trim().split(/\s+/)
    const camel = parts[0] + parts.slice(1).map((p) => p[0].toUpperCase() + p.slice(1)).join('')
    return '{{' + camel + '}}'
  })
}

function applyTemplate(template: TemplateDto, studentName: string, month: string): { subject: string; body: string } {
  return {
    subject: normalizePlaceholders(template.subject)
      .replace(/\{\{studentName\}\}/g, studentName)
      .replace(/\{\{month\}\}/g, month),
    body: normalizePlaceholders(template.body)
      .replace(/\{\{studentName\}\}/g, studentName)
      .replace(/\{\{month\}\}/g, month),
  }
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

export function ReviewEditorPage() {
  const { id } = useParams<{ id: string }>()
  const [, setLocation] = useLocation()
  const queryClient = useQueryClient()

  const { data: review, isLoading, error } = useQuery<ReviewDto>({
    queryKey: ['review', id],
    queryFn: () => fetchReview(id!),
    enabled: !!id,
  })

  const { data: templates = [] } = useQuery<TemplateDto[]>({
    queryKey: ['templates'],
    queryFn: fetchTemplates,
  })

  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [dirty, setDirty] = useState(false)
  const [testSendState, setTestSendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [testSendError, setTestSendError] = useState('')
  const [generateState, setGenerateState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [generateError, setGenerateError] = useState('')

  useEffect(() => {
    if (review) {
      setSubject(review.subject ?? '')
      setBody(review.body ?? '')
    }
  }, [review])

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/reviews/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, body }),
      })
      if (!res.ok) throw new Error('Failed to save draft')
      return res.json() as Promise<ReviewDto>
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['review', id], updated)
      setDirty(false)
    },
  })

  const sendMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/reviews/${id}/send`, { method: 'POST' })
      if (!res.ok) throw new Error('Failed to mark as sent')
      return res.json() as Promise<ReviewDto>
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(['review', id], updated)
    },
  })

  if (isLoading) return <div className="page" style={{ color: 'var(--color-muted)' }}>Loading…</div>
  if (error || !review) return <div className="page" style={{ color: 'var(--color-danger)' }}>Review not found.</div>

  const isSent = review.status === 'sent'
  const month = review.month

  async function handleTestSend() {
    setTestSendState('sending')
    setTestSendError('')
    try {
      if (dirty) await saveMutation.mutateAsync()
      const res = await fetch(`/api/reviews/${id}/send-test-pike13`, { method: 'POST' })
      const data = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Test send failed')
      setTestSendState('sent')
    } catch (err) {
      setTestSendError((err as Error).message)
      setTestSendState('error')
    }
  }

  const AI_PLACEHOLDERS = ['{{progress}}', '{{highlights}}', '{{instructorNotes}}']
  const bodyHasAiPlaceholders = AI_PLACEHOLDERS.some((p) => body.includes(p))

  async function handleGenerate() {
    setGenerateState('loading')
    setGenerateError('')
    try {
      const res = await fetch(`/api/reviews/${id}/generate-github-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyHasAiPlaceholders ? { template: body } : {}),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { error?: string }).error ?? 'Generation failed')
      }
      const data = await res.json() as { body: string; commitCount: number; repoCount: number }
      setBody(data.body)
      setDirty(true)
      setGenerateState('idle')
    } catch (err) {
      setGenerateError((err as Error).message)
      setGenerateState('error')
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <button
              style={{ color: 'inherit', background: 'none', border: 0, cursor: 'pointer', padding: 0, fontWeight: 600, fontSize: 'inherit', letterSpacing: 'inherit', textTransform: 'inherit' }}
              onClick={() => setLocation(`/reviews?month=${month}`)}
            >
              Reviews
            </button>
            {' / '}{review.studentName}
          </div>
          <h2>
            {review.studentName}
            <span style={{ marginLeft: 10 }}><StatusBadge status={review.status} /></span>
          </h2>
          <p>{month}{review.githubUsername && ` · @${review.githubUsername}`}</p>
        </div>
        {!isSent && (
          <div className="actions">
            <button
              className="btn ghost"
              onClick={handleTestSend}
              disabled={testSendState === 'sending'}
            >
              <Mail size={15} /> {testSendState === 'sending' ? 'Sending…' : 'Send test note'}
            </button>
            <button
              className="btn outline"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
            >
              <Save size={15} /> {saveMutation.isPending ? 'Saving…' : 'Save draft'}
            </button>
            <button
              className="btn primary"
              onClick={() => sendMutation.mutate()}
              disabled={sendMutation.isPending}
            >
              <Send size={15} /> {sendMutation.isPending ? 'Sending…' : 'Send to guardian'}
            </button>
          </div>
        )}
      </div>

      {isSent && (
        <p style={{ marginBottom: 16, borderRadius: 8, padding: '10px 14px', fontSize: 13, background: '#f0fdf4', color: 'var(--color-success)', border: '1px solid #bbf7d0' }}>
          This review has been marked as sent.
        </p>
      )}

      <div className="editor-grid">
        <div>
          <div className="form-row">
            <label>Subject</label>
            <input
              className="input"
              value={subject}
              onChange={(e) => { setSubject(e.target.value); setDirty(true) }}
              disabled={isSent}
            />
          </div>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label>Body</label>
            <div className="editor-toolbar">
              <select
                className="select"
                style={{ width: 'auto' }}
                onChange={(e) => {
                  const tpl = templates.find((t) => String(t.id) === e.target.value)
                  if (tpl) {
                    const applied = applyTemplate(tpl, review.studentName, month)
                    setSubject(applied.subject)
                    setBody(applied.body)
                    setDirty(true)
                  }
                  e.target.value = ''
                }}
                defaultValue=""
              >
                <option value="" disabled>Apply template…</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <button
                className="btn outline sm"
                onClick={handleGenerate}
                disabled={!review.githubUsername || generateState === 'loading'}
                title={
                  !review.githubUsername
                    ? 'No GitHub username linked'
                    : bodyHasAiPlaceholders
                    ? 'Fill in {{progress}}, {{highlights}}, {{instructorNotes}} using GitHub activity'
                    : 'Generate a full draft using GitHub commits this month'
                }
              >
                <GitCommit size={14} />
                {generateState === 'loading'
                  ? 'Generating…'
                  : bodyHasAiPlaceholders
                  ? 'Fill placeholders from GitHub'
                  : 'Generate from GitHub'}
              </button>
              <div style={{ flex: 1 }} />
              <span className="var-chip" title="Student's name">{'{{studentName}}'}</span>
              <span className="var-chip" title="Guardian's name">{'{{guardianName}}'}</span>
              <span className="var-chip" title="Month label">{'{{month}}'}</span>
              <span className="var-chip" title="AI fills this: what the student worked on" style={{ color: 'var(--color-primary)' }}>{'{{progress}}'}</span>
              <span className="var-chip" title="AI fills this: highlights and achievements" style={{ color: 'var(--color-primary)' }}>{'{{highlights}}'}</span>
              <span className="var-chip" title="AI fills this: instructor notes and next steps" style={{ color: 'var(--color-primary)' }}>{'{{instructorNotes}}'}</span>
            </div>
            <textarea
              className="textarea"
              value={body}
              onChange={(e) => { setBody(e.target.value); setDirty(true) }}
              disabled={isSent}
            />
          </div>
        </div>

        <div>
          <div className="card">
            <h3>About this review</h3>
            <div className="divider" />
            <div className="kv"><span className="k">Student</span><span className="v">{review.studentName}</span></div>
            {review.githubUsername && (
              <div className="kv">
                <span className="k">GitHub</span>
                <span className="v" style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>@{review.githubUsername}</span>
              </div>
            )}
            <div className="kv"><span className="k">Month</span><span className="v">{month}</span></div>
            <div className="kv"><span className="k">Status</span><span className="v"><StatusBadge status={review.status} /></span></div>
          </div>
        </div>
      </div>

      {testSendState === 'sent' && (
        <p style={{ marginTop: 12, fontSize: 13, color: 'var(--color-success)' }}>
          Test note sent to{' '}
          <a href="https://jtl.pike13.com/desk/clients/15025095" target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>
            Test Guardian
          </a>{' '}
          in Pike13.
        </p>
      )}
      {testSendState === 'error' && (
        <p style={{ marginTop: 12, fontSize: 13, color: 'var(--color-danger)' }}>Test note failed: {testSendError}</p>
      )}
      {saveMutation.isError && (
        <p style={{ marginTop: 12, fontSize: 13, color: 'var(--color-danger)' }}>Failed to save. Please try again.</p>
      )}
      {sendMutation.isError && (
        <p style={{ marginTop: 12, fontSize: 13, color: 'var(--color-danger)' }}>Failed to mark as sent. Please try again.</p>
      )}
      {generateState === 'error' && (
        <p style={{ marginTop: 12, fontSize: 13, color: 'var(--color-danger)' }}>Generate failed: {generateError}</p>
      )}
    </div>
  )
}
