import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { AdminDashboardPage } from '../../client/src/pages/AdminDashboardPage'

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
}

function renderPage() {
  const { hook } = memoryLocation({ path: '/admin' })
  return render(
    <QueryClientProvider client={makeClient()}>
      <Router hook={hook}>
        <AdminDashboardPage />
      </Router>
    </QueryClientProvider>,
  )
}

function mockFetch(options: {
  connected: boolean
  syncResult?: { studentsUpserted: number; assignmentsCreated: number; hoursCreated: number }
  syncOk?: boolean
}) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, opts?: RequestInit) => {
      if ((url as string).includes('/api/admin/notifications')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
      }
      if ((url as string).includes('/api/admin/pike13/status')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ connected: options.connected }),
        })
      }
      if (opts?.method === 'POST' && (url as string).includes('/api/admin/sync/pike13')) {
        const ok = options.syncOk !== false
        return Promise.resolve({
          ok,
          json: () =>
            Promise.resolve(
              ok
                ? (options.syncResult ?? { studentsUpserted: 0, assignmentsCreated: 0, hoursCreated: 0 })
                : { error: 'Sync failed' },
            ),
        })
      }
      return Promise.reject(new Error(`Unmocked fetch: ${url}`))
    }),
  )
}

describe('AdminDashboardPage — Pike13 section', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows "Not Connected" and Connect button when status is false', async () => {
    mockFetch({ connected: false })
    renderPage()

    expect(await screen.findByRole('button', { name: /Connect Pike13/i })).toBeInTheDocument()
  })

  it('shows "Connected" and Sync button when status is true', async () => {
    mockFetch({ connected: true })
    renderPage()

    expect(await screen.findByText(/Pike13 connected/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Sync now/i })).toBeInTheDocument()
  })

  it('clicking Sync fires POST /api/admin/sync/pike13', async () => {
    const postMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({ studentsUpserted: 5, assignmentsCreated: 3, hoursCreated: 2 }),
      }),
    )
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, opts?: RequestInit) => {
        if ((url as string).includes('/api/admin/notifications')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
        }
        if ((url as string).includes('/api/admin/pike13/status')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ connected: true }) })
        }
        if (opts?.method === 'POST' && (url as string).includes('/api/admin/sync/pike13')) {
          return postMock(url, opts)
        }
        return Promise.reject(new Error(`Unmocked fetch: ${url}`))
      }),
    )

    renderPage()
    const btn = await screen.findByRole('button', { name: /Sync now/i })
    await userEvent.click(btn)

    await waitFor(() => {
      expect(postMock).toHaveBeenCalled()
    })
  })

  it('displays sync result counts after successful sync', async () => {
    mockFetch({
      connected: true,
      syncResult: { studentsUpserted: 12, assignmentsCreated: 8, hoursCreated: 24 },
    })

    renderPage()
    const btn = await screen.findByRole('button', { name: /Sync now/i })
    await userEvent.click(btn)

    await screen.findByText(/12 students/i)
    expect(screen.getByText(/8 assignments/i)).toBeInTheDocument()
    expect(screen.getByText(/24 hours/i)).toBeInTheDocument()
  })
})
