import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { TrainingsPage } from '../../client/src/pages/TrainingsPage'

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function renderPage() {
  const { hook } = memoryLocation({ path: '/admin/trainings' })
  return render(
    <QueryClientProvider client={makeClient()}>
      <Router hook={hook}>
        <TrainingsPage />
      </Router>
    </QueryClientProvider>,
  )
}

const RESPONSE = {
  trainings: [{ id: 1, name: 'AB 506', description: 'CA mandated reporter' }],
  staff: [
    { id: 10, name: 'Trainer One', email: 't1@l', kind: 'instructor', active: true,
      records: [{ trainingTypeId: 1, met: true, driveUrl: 'https://drive/x', expiresAt: '2020-01-01T00:00:00Z', notes: null }] },
    { id: 11, name: 'Volunteer Two', email: 't2@l', kind: 'volunteer', active: true, records: [] },
  ],
}

afterEach(() => vi.restoreAllMocks())

describe('TrainingsPage', () => {
  it('renders staff rows with the training column', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(RESPONSE) })))
    renderPage()
    expect(await screen.findByText('Trainer One')).toBeInTheDocument()
    expect(screen.getByText('Volunteer Two')).toBeInTheDocument()
    expect(screen.getByText('AB 506')).toBeInTheDocument()
  })

  it('flags an expired training and shows the Drive link', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(RESPONSE) })))
    renderPage()
    await screen.findByText('Trainer One')
    // Trainer One's AB506 expired (2020) -> the cell shows an 'expired' marker
    expect(screen.getByText(/expired/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open folder/i })).toHaveAttribute('href', 'https://drive/x')
  })

  it('toggling a not-met checkbox PUTs the record', async () => {
    const putMock = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) }))
    vi.stubGlobal('fetch', vi.fn((url: string, opts?: RequestInit) => {
      if (opts?.method === 'PUT') return putMock(url, opts)
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(RESPONSE) })
    }))
    renderPage()
    await screen.findByText('Volunteer Two')
    // Volunteer Two has no record -> its checkbox is unchecked; toggle it
    const checkboxes = screen.getAllByRole('checkbox')
    // last checkbox belongs to Volunteer Two's AB506 cell
    await userEvent.click(checkboxes[checkboxes.length - 1])
    await waitFor(() => {
      expect(putMock).toHaveBeenCalled()
      const [[url]] = putMock.mock.calls as [[string]]
      expect(url).toMatch(/\/api\/admin\/trainings\/11\/1/)
    })
  })

  it('Run check button posts and reports the result', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string, opts?: RequestInit) => {
      if (opts?.method === 'POST' && url.includes('/check')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ alertCount: 2, notified: true, emailed: true }) })
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(RESPONSE) })
    }))
    renderPage()
    await screen.findByText('Trainer One')
    await userEvent.click(screen.getByRole('button', { name: /Run check/i }))
    expect(await screen.findByText(/2 item\(s\) flagged/i)).toBeInTheDocument()
  })
})
