import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { DashboardPage } from '../../client/src/pages/DashboardPage'

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
}

function renderDashboard(path = '/dashboard') {
  const { hook } = memoryLocation({ path })
  return render(
    <QueryClientProvider client={makeClient()}>
      <Router hook={hook}>
        <DashboardPage />
      </Router>
    </QueryClientProvider>,
  )
}

const mockDashboard = {
  month: '2026-02',
  totalStudents: 10,
  pending: 2,
  draft: 1,
  sent: 3,
}

const mockCheckinPending = {
  weekOf: '2026-02-24',
  alreadySubmitted: false,
  entries: [],
}

const mockCheckinSubmitted = {
  weekOf: '2026-02-24',
  alreadySubmitted: true,
  entries: [],
}

function mockFetch(checkin: typeof mockCheckinPending) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if ((url as string).includes('/api/instructor/dashboard')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockDashboard),
        })
      }
      if ((url as string).includes('/api/checkins/pending')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(checkin),
        })
      }
      return Promise.reject(new Error(`Unmocked fetch: ${url}`))
    }),
  )
}

describe('DashboardPage', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders stat cards with mocked API response', async () => {
    mockFetch(mockCheckinSubmitted)
    renderDashboard()

    // Wait for dashboard data to render
    expect(await screen.findByText('Total Students')).toBeInTheDocument()
    expect(await screen.findByText('Pending')).toBeInTheDocument()
    expect(await screen.findByText('Draft')).toBeInTheDocument()
    expect(await screen.findByText('Sent')).toBeInTheDocument()

    // Verify stat values
    const allTwos = await screen.findAllByText('2')
    expect(allTwos.length).toBeGreaterThan(0) // pending = 2
    expect(await screen.findByText('1')).toBeInTheDocument() // draft = 1
    expect(await screen.findByText('3')).toBeInTheDocument() // sent = 3
    expect(await screen.findByText('10')).toBeInTheDocument() // totalStudents = 10
  })

  it('shows check-in banner when alreadySubmitted is false', async () => {
    mockFetch(mockCheckinPending)
    renderDashboard()

    expect(await screen.findByText(/Submit now/i)).toBeInTheDocument()
    expect(screen.getByText(/TA check-in is due this week/i)).toBeInTheDocument()
  })

  it('hides check-in banner when alreadySubmitted is true', async () => {
    mockFetch(mockCheckinSubmitted)
    renderDashboard()

    // Wait for data to load
    expect(await screen.findByText('Total Students')).toBeInTheDocument()
    expect(screen.queryByText(/Submit now/i)).not.toBeInTheDocument()
  })

  it('dismisses check-in banner on clicking dismiss button', async () => {
    mockFetch(mockCheckinPending)
    renderDashboard()

    const dismiss = await screen.findByRole('button', { name: /Dismiss/i })
    await userEvent.click(dismiss)
    expect(screen.queryByText(/Submit now/i)).not.toBeInTheDocument()
  })
})
