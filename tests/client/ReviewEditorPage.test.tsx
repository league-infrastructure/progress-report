import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Router, Route } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { ReviewEditorPage } from '../../client/src/pages/ReviewEditorPage'
import type { ReviewDto } from '../../client/src/types/review'
import type { TemplateDto } from '../../client/src/types/template'

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
}

function renderEditor(path: string) {
  const { hook } = memoryLocation({ path })
  return render(
    <QueryClientProvider client={makeClient()}>
      <Router hook={hook}>
        <Route path="/reviews/:id">
          <ReviewEditorPage />
        </Route>
      </Router>
    </QueryClientProvider>,
  )
}

const DRAFT_REVIEW: ReviewDto = {
  id: 42,
  studentId: 1,
  studentName: 'Alice Smith',
  month: '2026-02',
  status: 'draft',
  subject: 'February Review',
  body: 'Good progress this month.',
  sentAt: null,
  createdAt: '2026-02-01T00:00:00Z',
  updatedAt: '2026-02-01T00:00:00Z',
}

const SENT_REVIEW: ReviewDto = {
  ...DRAFT_REVIEW,
  id: 43,
  status: 'sent',
  sentAt: '2026-02-15T00:00:00Z',
}

const TEMPLATES: TemplateDto[] = [
  {
    id: 1,
    name: 'Monthly Update',
    subject: 'Review for {{studentName}} - {{month}}',
    body: 'Dear {{studentName}}, here is your {{month}} review.',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
]

function setupFetch(review: ReviewDto, templates: TemplateDto[] = []) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, options?: RequestInit) => {
      if ((url as string).match(/\/api\/reviews\/\d+\/send/) && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ...review, status: 'sent', sentAt: '2026-03-01T00:00:00Z' }),
        })
      }
      if ((url as string).match(/\/api\/reviews\/\d+$/) && options?.method === 'PUT') {
        const body = JSON.parse(options.body as string)
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ...review, ...body, status: 'draft' }),
        })
      }
      if ((url as string).match(/\/api\/reviews\/\d+$/)) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(review),
        })
      }
      if ((url as string).includes('/api/templates')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(templates),
        })
      }
      return Promise.reject(new Error(`Unmocked fetch: ${url}`))
    }),
  )
}

describe('ReviewEditorPage', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders draft review with editable subject and body fields', async () => {
    setupFetch(DRAFT_REVIEW)
    renderEditor('/reviews/42')

    expect(await screen.findByDisplayValue('February Review')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Good progress this month.')).toBeInTheDocument()

    // Fields should be enabled for draft
    const subjectInput = screen.getByDisplayValue('February Review')
    expect(subjectInput).not.toBeDisabled()
    const bodyInput = screen.getByDisplayValue('Good progress this month.')
    expect(bodyInput).not.toBeDisabled()
  })

  it('clicking Save Draft fires PUT with field values', async () => {
    setupFetch(DRAFT_REVIEW)
    renderEditor('/reviews/42')

    await screen.findByDisplayValue('February Review')
    const subjectInput = screen.getByDisplayValue('February Review')
    await userEvent.clear(subjectInput)
    await userEvent.type(subjectInput, 'Updated Subject')

    await userEvent.click(screen.getByRole('button', { name: /Save Draft/i }))

    await waitFor(() => {
      const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls
      const putCall = calls.find(
        ([url, opts]) => (url as string).includes('/api/reviews/42') && (opts as RequestInit)?.method === 'PUT',
      )
      expect(putCall).toBeTruthy()
      const body = JSON.parse((putCall![1] as RequestInit).body as string)
      expect(body.subject).toBe('Updated Subject')
    })
  })

  it('renders sent review with read-only fields', async () => {
    setupFetch(SENT_REVIEW)
    renderEditor('/reviews/43')

    expect(await screen.findByText('This review has been marked as sent.')).toBeInTheDocument()

    const subjectInput = screen.getByDisplayValue('February Review')
    expect(subjectInput).toBeDisabled()

    const bodyInput = screen.getByDisplayValue('Good progress this month.')
    expect(bodyInput).toBeDisabled()

    // Action buttons should not be present
    expect(screen.queryByRole('button', { name: /Save Draft/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Send to guardian/i })).not.toBeInTheDocument()
  })

  it('clicking Mark as Sent fires send endpoint', async () => {
    setupFetch(DRAFT_REVIEW)
    renderEditor('/reviews/42')

    await screen.findByDisplayValue('February Review')
    await userEvent.click(screen.getByRole('button', { name: /Send to guardian/i }))

    await waitFor(() => {
      const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls
      const sendCall = calls.find(
        ([url, opts]) =>
          (url as string).includes('/api/reviews/42/send') && (opts as RequestInit)?.method === 'POST',
      )
      expect(sendCall).toBeTruthy()
    })
  })

  it('Apply Template select substitutes placeholders into subject and body', async () => {
    setupFetch(DRAFT_REVIEW, TEMPLATES)
    renderEditor('/reviews/42')

    await screen.findByDisplayValue('February Review')

    // The template control is an "Apply template…" <select>; picking a template
    // substitutes {{studentName}}/{{month}} into the subject and body fields.
    const templateSelect = screen.getByRole('combobox')
    await userEvent.selectOptions(templateSelect, 'Monthly Update')

    expect(screen.getByDisplayValue('Review for Alice Smith - 2026-02')).toBeInTheDocument()
    expect(
      screen.getByDisplayValue('Dear Alice Smith, here is your 2026-02 review.'),
    ).toBeInTheDocument()
  })
})
