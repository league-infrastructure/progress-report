import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { AdminFeedbackPage } from '../../client/src/pages/AdminFeedbackPage'
import type { AdminFeedbackDto } from '../../client/src/types/admin'

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function renderPage() {
  const { hook } = memoryLocation({ path: '/admin/feedback' })
  return render(
    <QueryClientProvider client={makeClient()}>
      <Router hook={hook}>
        <AdminFeedbackPage />
      </Router>
    </QueryClientProvider>,
  )
}

const ROWS: AdminFeedbackDto[] = [
  {
    id: 1,
    reviewId: 10,
    studentName: 'Alice',
    instructorName: 'Jane Doe',
    month: '2026-04',
    rating: 5,
    comment: 'Excellent!',
    submittedAt: '2026-04-15T10:00:00Z',
  },
  {
    id: 2,
    reviewId: 11,
    studentName: 'Bob',
    instructorName: 'John Smith',
    month: '2026-03',
    rating: 3,
    comment: null,
    submittedAt: '2026-03-20T09:00:00Z',
  },
]

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AdminFeedbackPage', () => {
  it('renders table rows with student, instructor, month, rating', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({ ok: true, json: () => Promise.resolve(ROWS) }),
      ),
    )

    renderPage()

    expect(await screen.findByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Jane Doe')).toBeInTheDocument()
    expect(screen.getByText('2026-04')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('Excellent!')).toBeInTheDocument()

    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('John Smith')).toBeInTheDocument()
    // Bob's null comment renders as an em-dash placeholder (one of possibly several).
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('shows "No feedback yet." when array is empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({ ok: true, json: () => Promise.resolve([]) }),
      ),
    )

    renderPage()

    expect(await screen.findByText('No feedback yet.')).toBeInTheDocument()
  })
})
