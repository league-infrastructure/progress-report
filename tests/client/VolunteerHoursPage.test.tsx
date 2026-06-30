import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { VolunteerHoursPage } from '../../client/src/pages/VolunteerHoursPage'
import type { VolunteerHourDto } from '../../client/src/types/admin'

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
}

function renderPage() {
  const { hook } = memoryLocation({ path: '/admin/volunteer-hours' })
  const result = render(
    <QueryClientProvider client={makeClient()}>
      <Router hook={hook}>
        <VolunteerHoursPage />
      </Router>
    </QueryClientProvider>,
  )
  return result
}

/** The page defaults to the Summary view; the entry list, per-row Delete,
 *  and Export CSV live in the Detail view. Switch to it before asserting. */
async function showDetailView() {
  await userEvent.click(screen.getByRole('button', { name: /^Detail$/i }))
}

const ENTRIES: VolunteerHourDto[] = [
  { id: 1, volunteerName: 'Alice', category: 'Teaching', hours: 2.5, description: 'Tutoring session', recordedAt: '2026-03-01T00:00:00Z', source: 'manual' },
  { id: 2, volunteerName: 'Bob', category: 'Events', hours: 1, description: null, recordedAt: '2026-03-05T00:00:00Z', source: 'pike13' },
]

function mockFetch(entries: VolunteerHourDto[], postResponse?: VolunteerHourDto) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, opts?: RequestInit) => {
      if (opts?.method === 'POST' && (url as string).includes('/api/admin/volunteer-hours')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(postResponse ?? entries[0]) })
      }
      if (opts?.method === 'DELETE' && (url as string).match(/\/api\/admin\/volunteer-hours\/\d+/)) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
      }
      if (opts?.method === 'PUT' && (url as string).match(/\/api\/admin\/volunteer-hours\/\d+/)) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(entries[0]) })
      }
      if ((url as string).includes('/api/admin/volunteer-hours')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(entries) })
      }
      return Promise.reject(new Error(`Unmocked fetch: ${url}`))
    }),
  )
}

describe('VolunteerHoursPage', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders list of entries from mocked GET /api/admin/volunteer-hours', async () => {
    mockFetch(ENTRIES)
    renderPage()
    await showDetailView()

    expect(await screen.findByText('Alice')).toBeInTheDocument()
    // 'Teaching' appears in both filter select options and entry badge — use getAllBy
    expect(screen.getAllByText('Teaching').length).toBeGreaterThan(0)
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getAllByText('Events').length).toBeGreaterThan(0)
  })

  it('Add Entry form submits POST with correct body', async () => {
    const postMock = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(ENTRIES[0]) }),
    )
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, opts?: RequestInit) => {
        if (opts?.method === 'POST') return postMock(url, opts)
        return Promise.resolve({ ok: true, json: () => Promise.resolve(ENTRIES) })
      }),
    )

    const { container } = renderPage()
    await showDetailView()
    await screen.findByText('Alice')

    await userEvent.click(screen.getByRole('button', { name: /Add Entry/i }))

    // EntryForm labels have no htmlFor — query by name attribute within the form
    const formEl = container.querySelector('form')!
    const nameInput = formEl.querySelector<HTMLInputElement>('input[name="volunteerName"]')!
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, 'Carol')

    const categorySelect = formEl.querySelector<HTMLSelectElement>('select[name="category"]')!
    await userEvent.selectOptions(categorySelect, 'Mentoring')

    const hoursInput = formEl.querySelector<HTMLInputElement>('input[name="hours"]')!
    await userEvent.clear(hoursInput)
    await userEvent.type(hoursInput, '3')

    await userEvent.click(screen.getByRole('button', { name: /^Save$/i }))

    await waitFor(() => {
      expect(postMock).toHaveBeenCalled()
      const [[calledUrl, calledOpts]] = postMock.mock.calls as [[string, RequestInit]]
      expect(calledUrl).toContain('/api/admin/volunteer-hours')
      const body = JSON.parse(calledOpts.body as string)
      expect(body.volunteerName).toBe('Carol')
      expect(body.category).toBe('Mentoring')
      expect(body.hours).toBe(3)
    })
  })

  it('Delete button fires DELETE /api/admin/volunteer-hours/:id', async () => {
    const deleteMock = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
    )
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, opts?: RequestInit) => {
        if (opts?.method === 'DELETE') return deleteMock(url, opts)
        return Promise.resolve({ ok: true, json: () => Promise.resolve(ENTRIES) })
      }),
    )

    renderPage()
    await showDetailView()
    await screen.findByText('Alice')

    // First Delete button belongs to Alice (id=1, source=manual)
    const deleteButtons = screen.getAllByRole('button', { name: /Delete/i })
    const aliceDelete = deleteButtons[0]
    await userEvent.click(aliceDelete)

    await waitFor(() => {
      expect(deleteMock).toHaveBeenCalled()
      const [[calledUrl, calledOpts]] = deleteMock.mock.calls as [[string, RequestInit]]
      expect(calledUrl).toMatch(/\/api\/admin\/volunteer-hours\/1/)
      expect(calledOpts?.method).toBe('DELETE')
    })
  })

  it('pike13 row has Delete button disabled', async () => {
    mockFetch(ENTRIES)
    renderPage()
    await showDetailView()

    await screen.findByText('Bob')

    // There are two Delete buttons; Bob (pike13) is second
    const deleteButtons = await screen.findAllByRole('button', { name: /Delete/i })
    const bobDelete = deleteButtons[1]
    expect(bobDelete).toBeDisabled()
  })

  it('CSV export triggers URL.createObjectURL with a Blob', async () => {
    mockFetch(ENTRIES)
    const createObjectURL = vi.fn(() => 'blob:mock')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })

    // a.click needs to be a no-op
    const origCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = origCreate(tag)
      if (tag === 'a') vi.spyOn(el as HTMLAnchorElement, 'click').mockImplementation(() => {})
      return el
    })

    renderPage()
    await showDetailView()
    await screen.findByText('Alice')

    await userEvent.click(screen.getByRole('button', { name: /Export CSV/i }))

    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
  })
})
