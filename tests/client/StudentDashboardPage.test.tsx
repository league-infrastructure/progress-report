import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { StudentDashboardPage } from '../../client/src/pages/StudentDashboardPage'

function renderDashboard(path = '/quiz/dashboard') {
  const { hook } = memoryLocation({ path })
  return render(
    <Router hook={hook}>
      <StudentDashboardPage />
    </Router>,
  )
}

const assignedQuiz = {
  id: 7,
  status: 'assigned',
  lessonId: 3,
  lessonName: 'Variables and Types',
  module: 'Python Apprentice',
  levelId: 1,
  createdAt: '2026-06-29T12:00:00.000Z',
}
const completedQuiz = { ...assignedQuiz, id: 8, status: 'completed', lessonName: 'Loops' }

describe('StudentDashboardPage', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('lists the student’s assigned quizzes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([assignedQuiz, completedQuiz]) })),
    )
    renderDashboard()

    expect(await screen.findByText('Variables and Types')).toBeInTheDocument()
    expect(screen.getByText('Loops')).toBeInTheDocument()
    // assigned -> has a Start button; completed -> shows a Completed badge
    expect(screen.getByRole('button', { name: /Start quiz/i })).toBeInTheDocument()
    expect(screen.getByText(/Completed/i)).toBeInTheDocument()
  })

  it('shows an empty state when no quizzes are assigned', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) })),
    )
    renderDashboard()

    expect(await screen.findByText(/don't have any quizzes yet/i)).toBeInTheDocument()
  })

  it('redirects to GitHub login on a 401', async () => {
    const assignHref = vi.fn()
    // jsdom: replace window.location with a writable href setter
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { set href(v: string) { assignHref(v) }, get href() { return '' } },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({ error: 'Unauthenticated' }) })),
    )
    renderDashboard()

    // give the effect a tick to run
    await screen.findByText(/Loading your quizzes/i).catch(() => null)
    await new Promise((r) => setTimeout(r, 0))
    expect(assignHref).toHaveBeenCalledWith('/api/auth/github')
  })

  it('opens a quiz to take when Start quiz is clicked', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.endsWith('/api/quiz/student/quizzes')) {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([assignedQuiz]) })
        }
        if (url.includes('/questions')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({
              quizId: 7,
              status: 'assigned',
              questions: [
                { id: 'q1', type: 'multiple_choice', category: 'x', question: 'What is 2+2?', code: null, options: ['3', '4'] },
              ],
            }),
          })
        }
        return Promise.reject(new Error(`Unmocked: ${url}`))
      }),
    )
    renderDashboard()

    const start = await screen.findByRole('button', { name: /Start quiz/i })
    await userEvent.click(start)
    expect(await screen.findByText(/What is 2\+2\?/)).toBeInTheDocument()
  })
})
