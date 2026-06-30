import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { InstructorQuizTabPage } from '../../client/src/pages/InstructorQuizTabPage'

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function renderPage() {
  const { hook } = memoryLocation({ path: '/quizzes' })
  return render(
    <QueryClientProvider client={makeClient()}>
      <Router hook={hook}>
        <InstructorQuizTabPage />
      </Router>
    </QueryClientProvider>,
  )
}

const COMPLETED_ROW = {
  quizId: 7,
  status: 'completed',
  createdAt: '2026-06-20T00:00:00Z',
  studentId: 1,
  studentName: 'Alice',
  githubUsername: 'alice',
  lessonName: 'Variables',
  score: 80,
  passed: true,
  submittedAt: '2026-06-21T00:00:00Z',
  parentNoteSentAt: null,
}

const REVIEW = {
  quizId: 7,
  status: 'completed',
  studentName: 'Alice',
  parentEmail: 'parent@home.test',
  lessonName: 'Variables',
  score: 80,
  passed: true,
  results: [
    { questionId: 'q1', correct: true, studentAnswer: '2', correctAnswer: '2', explanation: '' },
    { questionId: 'q2', correct: false, studentAnswer: '1', correctAnswer: '4', explanation: '' },
  ],
  parentNote: null,
  parentNoteSentAt: null,
}

function mockBaseFetch(extra?: (url: string, opts?: RequestInit) => unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, opts?: RequestInit) => {
      const custom = extra?.(url, opts)
      if (custom) return custom
      if (url.includes('/instructor/my-students')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([COMPLETED_ROW]) })
      }
      if (url.includes('/instructor/roster')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
      }
      if (url.includes('/instructor/levels')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    }),
  )
}

describe('InstructorQuizTabPage — parent-note review', () => {
  afterEach(() => vi.restoreAllMocks())

  it('marks a completed unsent quiz as "Awaiting review" and opens the review panel', async () => {
    mockBaseFetch((url) => {
      if (url.includes('/quizzes/7/review')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(REVIEW) })
      }
      return null
    })
    renderPage()

    expect(await screen.findByText('Awaiting review')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Review & send/i }))

    // Review panel shows score, the incorrect answer's correct value, and the parent email
    expect(await screen.findByText('80%')).toBeInTheDocument()
    expect(screen.getByText(/correct: 4/i)).toBeInTheDocument()
    expect(screen.getByText(/parent@home\.test/)).toBeInTheDocument()
  })

  it('sends the note to the parent and shows a last-sent timestamp', async () => {
    const sendMock = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ emailed: true, parentNoteSentAt: '2026-06-29T12:00:00Z' }) }),
    )
    mockBaseFetch((url, opts) => {
      if (url.includes('/quizzes/7/review')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(REVIEW) })
      }
      if (url.includes('/send-parent-note') && opts?.method === 'POST') {
        return sendMock()
      }
      return null
    })
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: /Review & send/i }))
    await screen.findByText('80%')

    const note = screen.getByPlaceholderText(/Add a short note/i)
    await userEvent.type(note, 'Nice work.')
    await userEvent.click(screen.getByRole('button', { name: /Send to parent/i }))

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalled()
      expect(screen.getByText(/Last sent/i)).toBeInTheDocument()
    })
  })
})
