import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { AdminDashboardPage } from '../../client/src/pages/AdminDashboardPage'
import type { AdminNotificationDto } from '../../client/src/types/admin'

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

const NOTIFICATIONS: AdminNotificationDto[] = [
  { id: 1, fromUserName: 'Alice', message: 'Needs review', isRead: false, createdAt: '2026-03-01T00:00:00Z' },
  { id: 2, fromUserName: 'Bob', message: 'Already read', isRead: true, createdAt: '2026-03-02T00:00:00Z' },
]

function mockFetch(notifications: AdminNotificationDto[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if ((url as string).includes('/api/admin/notifications')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(notifications) })
      }
      if ((url as string).includes('/api/admin/pike13/status')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ connected: false }) })
      }
      return Promise.reject(new Error(`Unmocked fetch: ${url}`))
    }),
  )
}

describe('AdminDashboardPage', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders notification list from mocked API response', async () => {
    mockFetch(NOTIFICATIONS)
    renderPage()

    expect(await screen.findByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Needs review')).toBeInTheDocument()
  })

  it('shows unread badge count', async () => {
    mockFetch(NOTIFICATIONS)
    renderPage()

    // 1 unread notification — badge should show "1"
    expect(await screen.findByText('1')).toBeInTheDocument()
  })

  it('Mark as Read button fires PATCH /api/admin/notifications/:id/read', async () => {
    const patchMock = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
    )
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, opts?: RequestInit) => {
        if (opts?.method === 'PATCH' && (url as string).includes('/read')) {
          return patchMock(url, opts)
        }
        if ((url as string).includes('/api/admin/notifications')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(NOTIFICATIONS) })
        }
        if ((url as string).includes('/api/admin/pike13/status')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ connected: false }) })
        }
        return Promise.reject(new Error(`Unmocked fetch: ${url}`))
      }),
    )

    renderPage()
    const btn = await screen.findByRole('button', { name: /Mark read/i })
    await userEvent.click(btn)

    await waitFor(() => {
      expect(patchMock).toHaveBeenCalled()
      const [[calledUrl]] = patchMock.mock.calls as [[string, RequestInit]]
      expect(calledUrl).toMatch(/\/api\/admin\/notifications\/1\/read/)
    })
  })

  it('shows "No notifications" when list is empty', async () => {
    mockFetch([])
    renderPage()

    expect(await screen.findByText(/No unread notifications/i)).toBeInTheDocument()
  })
})
