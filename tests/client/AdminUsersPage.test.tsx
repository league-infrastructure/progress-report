import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { AdminUsersPage } from '../../client/src/pages/AdminUsersPage'

// Mock useAuth so we can control the current user
vi.mock('../../client/src/hooks/useAuth', () => ({
  useAuth: vi.fn(),
}))

import { useAuth } from '../../client/src/hooks/useAuth'

const mockUseAuth = useAuth as ReturnType<typeof vi.fn>

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
}

function renderPage() {
  const { hook } = memoryLocation({ path: '/admin/users' })
  return render(
    <QueryClientProvider client={makeClient()}>
      <Router hook={hook}>
        <AdminUsersPage />
      </Router>
    </QueryClientProvider>,
  )
}

const ADMIN_USERS = [
  { email: 'alice@example.com', createdAt: '2024-01-15T00:00:00.000Z' },
  { email: 'bob@example.com',   createdAt: '2024-02-20T00:00:00.000Z' },
]

describe('AdminUsersPage', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders loading state initially', () => {
    mockUseAuth.mockReturnValue({ user: { email: 'alice@example.com' }, isLoading: false })
    // Fetch that never resolves during this test
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    )

    renderPage()
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('renders list of admin emails after fetch', async () => {
    mockUseAuth.mockReturnValue({ user: { email: 'alice@example.com' }, isLoading: false })
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({ ok: true, json: () => Promise.resolve(ADMIN_USERS) }),
      ),
    )

    renderPage()

    expect(await screen.findByText('alice@example.com')).toBeInTheDocument()
    expect(screen.getByText('bob@example.com')).toBeInTheDocument()
  })

  it('does NOT show Remove button for the current user\'s own email', async () => {
    mockUseAuth.mockReturnValue({ user: { email: 'alice@example.com' }, isLoading: false })
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({ ok: true, json: () => Promise.resolve(ADMIN_USERS) }),
      ),
    )

    renderPage()

    await screen.findByText('alice@example.com')

    // There should be exactly one Remove button (for bob, not alice)
    const removeButtons = screen.getAllByRole('button', { name: /remove/i })
    expect(removeButtons).toHaveLength(1)
  })

  it('clicking Remove on another user triggers confirmation and DELETE call', async () => {
    mockUseAuth.mockReturnValue({ user: { email: 'alice@example.com' }, isLoading: false })

    const deleteMock = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
    )
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, opts?: RequestInit) => {
        if (opts?.method === 'DELETE') return deleteMock(url, opts)
        return Promise.resolve({ ok: true, json: () => Promise.resolve(ADMIN_USERS) })
      }),
    )
    vi.stubGlobal('confirm', vi.fn(() => true))

    renderPage()

    const removeBtn = await screen.findByRole('button', { name: /remove/i })
    await userEvent.click(removeBtn)

    await waitFor(() => {
      expect(window.confirm).toHaveBeenCalled()
      expect(deleteMock).toHaveBeenCalled()
      const [[calledUrl]] = deleteMock.mock.calls as [[string]]
      expect(calledUrl).toContain('/api/admin/users/')
      expect(calledUrl).toContain(encodeURIComponent('bob@example.com'))
    })
  })

  it('submitting the add form calls POST and clears the input', async () => {
    mockUseAuth.mockReturnValue({ user: { email: 'alice@example.com' }, isLoading: false })

    const postMock = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }),
    )
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, opts?: RequestInit) => {
        if (opts?.method === 'POST') return postMock(url, opts)
        return Promise.resolve({ ok: true, json: () => Promise.resolve(ADMIN_USERS) })
      }),
    )

    renderPage()

    await screen.findByText('alice@example.com')

    const input = screen.getByPlaceholderText('user@example.com')
    await userEvent.type(input, 'charlie@example.com')
    await userEvent.click(screen.getByRole('button', { name: /add admin/i }))

    await waitFor(() => {
      expect(postMock).toHaveBeenCalled()
      const [[, calledOpts]] = postMock.mock.calls as [[string, RequestInit]]
      expect(JSON.parse(calledOpts.body as string)).toEqual({ email: 'charlie@example.com' })
    })

    // Input should be cleared after success
    await waitFor(() => {
      expect(input).toHaveValue('')
    })
  })

  it('409 from add API shows inline error "Already an admin"', async () => {
    mockUseAuth.mockReturnValue({ user: { email: 'alice@example.com' }, isLoading: false })

    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, opts?: RequestInit) => {
        if (opts?.method === 'POST') {
          return Promise.resolve({ ok: false, status: 409, json: () => Promise.resolve({}) })
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve(ADMIN_USERS) })
      }),
    )

    renderPage()

    await screen.findByText('alice@example.com')

    const input = screen.getByPlaceholderText('user@example.com')
    await userEvent.type(input, 'alice@example.com')
    await userEvent.click(screen.getByRole('button', { name: /add admin/i }))

    expect(await screen.findByText('Already an admin')).toBeInTheDocument()
  })
})
