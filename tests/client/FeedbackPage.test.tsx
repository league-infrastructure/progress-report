import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { FeedbackPage } from '../../client/src/pages/FeedbackPage'
import type { FeedbackContextDto } from '../../client/src/types/feedback'

const TOKEN = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

function renderPage() {
  const { hook } = memoryLocation({ path: `/feedback/${TOKEN}` })
  return render(
    <Router hook={hook}>
      <FeedbackPage />
    </Router>,
  )
}

function mockGet(status: number, body?: FeedbackContextDto) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, opts?: RequestInit) => {
      if (!opts?.method || opts.method === 'GET') {
        return Promise.resolve({
          status,
          ok: status >= 200 && status < 300,
          json: () => Promise.resolve(body),
        })
      }
      return Promise.reject(new Error(`Unmocked POST: ${url}`))
    }),
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('FeedbackPage', () => {
  it('shows "Feedback link not found" when GET returns 404', async () => {
    mockGet(404)
    renderPage()
    expect(await screen.findByText('Feedback link not found.')).toBeInTheDocument()
  })

  it('shows "Feedback already submitted" when alreadySubmitted is true', async () => {
    mockGet(200, { studentName: 'Alice', month: '2026-04', alreadySubmitted: true })
    renderPage()
    expect(await screen.findByText('Already submitted')).toBeInTheDocument()
  })

  it('renders star buttons and Submit when alreadySubmitted is false', async () => {
    mockGet(200, { studentName: 'Alice', month: '2026-04', alreadySubmitted: false })
    renderPage()

    expect(await screen.findByLabelText('1 star')).toBeInTheDocument()
    expect(screen.getByLabelText('5 star')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Submit/i })).toBeDisabled()
  })

  it('Submit posts with rating and shows "Thank you" on 201', async () => {
    const postMock = vi.fn(() =>
      Promise.resolve({ status: 201, ok: true, json: () => Promise.resolve({ id: 1 }) }),
    )
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, opts?: RequestInit) => {
        if (opts?.method === 'POST') return postMock(url, opts)
        return Promise.resolve({
          status: 200,
          ok: true,
          json: () => Promise.resolve({ studentName: 'Alice', month: '2026-04', alreadySubmitted: false }),
        })
      }),
    )

    renderPage()
    await screen.findByLabelText('4 star')

    await userEvent.click(screen.getByLabelText('4 star'))
    await userEvent.click(screen.getByRole('button', { name: /Submit/i }))

    expect(await screen.findByText('Thank you!')).toBeInTheDocument()

    const [[, calledOpts]] = postMock.mock.calls as [[string, RequestInit]]
    const body = JSON.parse(calledOpts.body as string)
    expect(body.rating).toBe(4)
  })

  it('shows "Feedback already submitted" when POST returns 409', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, opts?: RequestInit) => {
        if (opts?.method === 'POST') {
          return Promise.resolve({ status: 409, ok: false, json: () => Promise.resolve({}) })
        }
        return Promise.resolve({
          status: 200,
          ok: true,
          json: () => Promise.resolve({ studentName: 'Bob', month: '2026-04', alreadySubmitted: false }),
        })
      }),
    )

    renderPage()
    await screen.findByLabelText('3 star')
    await userEvent.click(screen.getByLabelText('3 star'))
    await userEvent.click(screen.getByRole('button', { name: /Submit/i }))

    await waitFor(() => {
      expect(screen.getByText('Already submitted')).toBeInTheDocument()
    })
  })
})
