import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { AdminInstructorDto } from '../types/admin'

// ---- API helpers ----

async function fetchInstructors(): Promise<AdminInstructorDto[]> {
  const res = await fetch('/api/admin/instructors')
  if (!res.ok) throw new Error('Failed to load instructors')
  return res.json()
}

async function toggleInstructor(id: number, isActive: boolean): Promise<AdminInstructorDto> {
  const res = await fetch(`/api/admin/instructors/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isActive }),
  })
  if (!res.ok) throw new Error('Failed to update instructor')
  return res.json()
}

async function sendReminders(instructorIds: number[], month: string): Promise<{ sent: number; skipped: number; errors: string[] }> {
  const res = await fetch('/api/admin/instructors/email-reminders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instructorIds, month }),
  })
  if (!res.ok) throw new Error('Failed to send reminders')
  return res.json()
}

// ---- Types ----

type SortKey = 'name' | 'email' | 'studentCount' | 'isActive'
type SortDir = 'asc' | 'desc'

function getCurrentMonth(): string {
  return new Date().toISOString().slice(0, 7)
}

// ---- Sort icon ----

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <span className="ml-1 text-slate-300">↕</span>
  return <span className="ml-1 text-blue-600">{sortDir === 'asc' ? '↑' : '↓'}</span>
}

const BADGE_CLASS: Record<string, string> = {
  ok: '',
  warning: 'bg-yellow-100 text-yellow-800',
  alert: 'bg-red-100 text-red-800',
}

// ---- Main page ----

export function InstructorListPage() {
  const queryClient = useQueryClient()

  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [month, setMonth] = useState(getCurrentMonth())
  const [reminderResult, setReminderResult] = useState<{ sent: number; skipped: number; errors: string[] } | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)

  const { data: instructors = [], isLoading, error } = useQuery<AdminInstructorDto[]>({
    queryKey: ['admin', 'instructors'],
    queryFn: fetchInstructors,
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      toggleInstructor(id, isActive),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'instructors'] }),
  })

  const reminderMutation = useMutation({
    mutationFn: ({ ids, month }: { ids: number[]; month: string }) => sendReminders(ids, month),
    onSuccess: (data) => {
      setReminderResult(data)
      setShowConfirm(false)
      setSelected(new Set())
    },
  })

  // Sort handler
  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  // Filtered + sorted list
  const displayed = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = q
      ? instructors.filter(
          (i) => i.name.toLowerCase().includes(q) || i.email.toLowerCase().includes(q),
        )
      : instructors

    return [...filtered].sort((a, b) => {
      let cmp = 0
      if (sortKey === 'name') cmp = a.name.localeCompare(b.name)
      else if (sortKey === 'email') cmp = a.email.localeCompare(b.email)
      else if (sortKey === 'studentCount') cmp = a.studentCount - b.studentCount
      else if (sortKey === 'isActive') cmp = Number(b.isActive) - Number(a.isActive)
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [instructors, search, sortKey, sortDir])

  // Select all (only within currently displayed rows)
  const displayedIds = useMemo(() => displayed.map((i) => i.id), [displayed])
  const allDisplayedSelected =
    displayedIds.length > 0 && displayedIds.every((id) => selected.has(id))
  const someDisplayedSelected = displayedIds.some((id) => selected.has(id))

  function toggleSelectAll() {
    if (allDisplayedSelected) {
      setSelected((prev) => {
        const next = new Set(prev)
        displayedIds.forEach((id) => next.delete(id))
        return next
      })
    } else {
      setSelected((prev) => {
        const next = new Set(prev)
        displayedIds.forEach((id) => next.add(id))
        return next
      })
    }
  }

  function toggleRow(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectedIds = [...selected]
  const selectedInstructors = instructors.filter((i) => selected.has(i.id))

  function handleSendClick() {
    setReminderResult(null)
    setShowConfirm(true)
  }

  function thClass(_key: SortKey) {
    void _key
    return `cursor-pointer select-none px-4 py-3 text-left font-medium text-slate-600 hover:text-slate-800 whitespace-nowrap`
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-slate-800">Instructors</h1>

      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="search"
          placeholder="Search name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64 rounded border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <span className="text-sm text-slate-500">
          {displayed.length} instructor{displayed.length !== 1 ? 's' : ''}
          {someDisplayedSelected && ` · ${selectedIds.length} selected`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {someDisplayedSelected && (
            <>
              <label className="text-sm text-slate-600">Month</label>
              <input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="rounded border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={handleSendClick}
                disabled={reminderMutation.isPending}
                className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                Send Review Reminders ({selectedIds.length})
              </button>
            </>
          )}
        </div>
      </div>

      {/* Result banner */}
      {reminderResult && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          Sent {reminderResult.sent} email{reminderResult.sent !== 1 ? 's' : ''}.
          {reminderResult.skipped > 0 && ` Skipped ${reminderResult.skipped} (no pending reviews).`}
          {reminderResult.errors.length > 0 && (
            <span className="text-red-700"> Errors: {reminderResult.errors.join(', ')}</span>
          )}
          <button
            onClick={() => setReminderResult(null)}
            className="ml-3 font-medium underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {isLoading && <p className="text-slate-500">Loading…</p>}
      {error && <p className="text-red-600">Failed to load instructors.</p>}

      {!isLoading && displayed.length === 0 && (
        <p className="text-slate-500">No instructors found.</p>
      )}

      {displayed.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allDisplayedSelected}
                    ref={(el) => { if (el) el.indeterminate = someDisplayedSelected && !allDisplayedSelected }}
                    onChange={toggleSelectAll}
                    className="rounded border-slate-300"
                  />
                </th>
                <th className={thClass('name')} onClick={() => handleSort('name')}>
                  Name <SortIcon col="name" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th className={thClass('email')} onClick={() => handleSort('email')}>
                  Email <SortIcon col="email" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th className={thClass('studentCount')} onClick={() => handleSort('studentCount')}>
                  Students <SortIcon col="studentCount" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">Ratio</th>
                <th className={thClass('isActive')} onClick={() => handleSort('isActive')}>
                  Status <SortIcon col="isActive" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {displayed.map((instr) => (
                <tr
                  key={instr.id}
                  className={`hover:bg-slate-50 ${selected.has(instr.id) ? 'bg-blue-50' : ''}`}
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(instr.id)}
                      onChange={() => toggleRow(instr.id)}
                      className="rounded border-slate-300"
                    />
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-800">{instr.name}</td>
                  <td className="px-4 py-3 text-slate-600">{instr.email}</td>
                  <td className="px-4 py-3 text-slate-700">{instr.studentCount}</td>
                  <td className="px-4 py-3">
                    {instr.ratioBadge !== 'ok' ? (
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BADGE_CLASS[instr.ratioBadge]}`}>
                        {instr.ratioBadge}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${instr.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                      {instr.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleMutation.mutate({ id: instr.id, isActive: !instr.isActive })}
                      disabled={toggleMutation.isPending}
                      className="rounded bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200 disabled:opacity-50"
                    >
                      {instr.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Confirm send modal */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="mb-2 text-lg font-semibold text-slate-800">Send Review Reminders</h2>
            <p className="mb-1 text-sm text-slate-600">
              Sending reminders for <strong>{month}</strong> to:
            </p>
            <ul className="mb-4 max-h-40 overflow-y-auto rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              {selectedInstructors.map((i) => (
                <li key={i.id} className="py-0.5">
                  {i.name} <span className="text-slate-400">({i.email})</span>
                </li>
              ))}
            </ul>
            <p className="mb-4 text-xs text-slate-500">
              Each email will list the students whose reviews haven't been sent yet this month.
              Instructors with no pending students will be skipped.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowConfirm(false)}
                className="rounded bg-slate-100 px-4 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-200"
              >
                Cancel
              </button>
              <button
                onClick={() => reminderMutation.mutate({ ids: selectedIds, month })}
                disabled={reminderMutation.isPending}
                className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {reminderMutation.isPending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
