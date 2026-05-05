import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { VolunteerHourDto, VolunteerSummaryDto, ScheduleEventDto } from '../types/admin'

// ---- Helpers ----

function ytdFrom(): string {
  return `${new Date().getFullYear()}-01-01`
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function buildUrl(filters: Filters): string {
  const params = new URLSearchParams()
  if (filters.volunteerName) params.set('volunteerName', filters.volunteerName)
  if (filters.category) params.set('category', filters.category)
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  const qs = params.toString()
  return `/api/admin/volunteer-hours${qs ? '?' + qs : ''}`
}

function buildSummaryUrl(from: string, to: string): string {
  return `/api/admin/volunteer-hours/summary?from=${from}&to=${to}`
}

async function fetchSummary(from: string, to: string): Promise<VolunteerSummaryDto[]> {
  const res = await fetch(buildSummaryUrl(from, to))
  if (!res.ok) throw new Error('Failed to load volunteer summary')
  return res.json()
}

async function fetchHours(filters: Filters): Promise<VolunteerHourDto[]> {
  const res = await fetch(buildUrl(filters))
  if (!res.ok) throw new Error('Failed to load volunteer hours')
  return res.json()
}

async function createHours(body: HoursFormData): Promise<VolunteerHourDto> {
  const res = await fetch('/api/admin/volunteer-hours', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error('Failed to create entry')
  return res.json()
}

async function updateHours(id: number, body: Partial<HoursFormData>): Promise<VolunteerHourDto> {
  const res = await fetch(`/api/admin/volunteer-hours/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error('Failed to update entry')
  return res.json()
}

async function deleteHours(id: number): Promise<void> {
  const res = await fetch(`/api/admin/volunteer-hours/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to delete entry')
}

function exportToCsv(rows: VolunteerHourDto[], filename: string) {
  const header = ['Volunteer', 'Category', 'Hours', 'Description', 'Date', 'Source']
  const lines = rows.map((r) =>
    [
      r.volunteerName,
      r.category,
      r.hours,
      r.description ?? '',
      r.recordedAt.slice(0, 10),
      r.source,
    ].join(','),
  )
  const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ---- Types ----

interface Filters {
  volunteerName: string
  category: string
  from: string
  to: string
}

interface HoursFormData {
  volunteerName: string
  category: string
  hours: number
  description?: string
  recordedAt?: string
}

const EMPTY_FORM: HoursFormData = {
  volunteerName: '',
  category: '',
  hours: 0,
  description: '',
  recordedAt: today(),
}

// ---- Entry form ----

interface EntryFormProps {
  initial?: HoursFormData
  onSubmit: (data: HoursFormData) => void
  onCancel: () => void
  isPending: boolean
}

function EntryForm({ initial = EMPTY_FORM, onSubmit, onCancel, isPending }: EntryFormProps) {
  const [form, setForm] = useState<HoursFormData>(initial)

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: name === 'hours' ? parseFloat(value) || 0 : value }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    onSubmit(form)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Volunteer Name</label>
          <input
            name="volunteerName"
            value={form.volunteerName}
            onChange={handleChange}
            required
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Category</label>
          <select
            name="category"
            value={form.category}
            onChange={handleChange}
            required
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select…</option>
            <option value="Teaching">Teaching</option>
            <option value="Events">Events</option>
            <option value="Mentoring">Mentoring</option>
            <option value="Admin">Admin</option>
            <option value="Other">Other</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Hours</label>
          <input
            type="number"
            name="hours"
            value={form.hours}
            onChange={handleChange}
            required
            min={0}
            step={0.5}
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Date</label>
          <input
            type="date"
            name="recordedAt"
            value={form.recordedAt}
            onChange={handleChange}
            className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">Description (optional)</label>
        <input
          name="description"
          value={form.description ?? ''}
          onChange={handleChange}
          className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded bg-slate-100 px-4 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-200"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

// ---- Summary table ----

type SummarySortKey = 'volunteerName' | 'totalHours' | 'isScheduled'
type SortDir = 'asc' | 'desc'

function SummarySortIcon({ col, sortKey, sortDir }: { col: SummarySortKey; sortKey: SummarySortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <span className="ml-1 text-slate-300">↕</span>
  return <span className="ml-1 text-blue-600">{sortDir === 'asc' ? '↑' : '↓'}</span>
}

function SummaryTable({ rows }: { rows: VolunteerSummaryDto[] }) {
  const [sortKey, setSortKey] = useState<SummarySortKey>('totalHours')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  function handleSort(key: SummarySortKey) {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      let cmp = 0
      if (sortKey === 'volunteerName') cmp = a.volunteerName.localeCompare(b.volunteerName)
      else if (sortKey === 'totalHours') cmp = Number(a.totalHours) - Number(b.totalHours)
      else if (sortKey === 'isScheduled') cmp = Number(a.isScheduled) - Number(b.isScheduled)
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [rows, sortKey, sortDir])

  if (rows.length === 0) return <p className="text-slate-500">No volunteer hours recorded for this period.</p>

  const thClass = 'cursor-pointer select-none px-4 py-2.5 text-left font-medium text-slate-600 hover:text-slate-800 whitespace-nowrap'

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="border-b border-slate-200 bg-slate-50">
          <tr>
            <th className={thClass} onClick={() => handleSort('volunteerName')}>
              Volunteer <SummarySortIcon col="volunteerName" sortKey={sortKey} sortDir={sortDir} />
            </th>
            <th className={`${thClass} text-right`} onClick={() => handleSort('totalHours')}>
              YTD Hours <SummarySortIcon col="totalHours" sortKey={sortKey} sortDir={sortDir} />
            </th>
            <th className={`${thClass} text-center`} onClick={() => handleSort('isScheduled')}>
              Scheduled <SummarySortIcon col="isScheduled" sortKey={sortKey} sortDir={sortDir} />
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {sorted.map((row) => (
            <tr key={row.volunteerName} className="hover:bg-slate-50">
              <td className="px-4 py-2.5 font-medium text-slate-800">{row.volunteerName}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                {Number(row.totalHours).toFixed(1)}
              </td>
              <td className="px-4 py-2.5 text-center">
                {row.isScheduled ? (
                  <span className="inline-block rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                    Scheduled
                  </span>
                ) : (
                  <span className="inline-block rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500">
                    Not scheduled
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---- Schedule view ----

/** Format a Date as a local YYYY-MM-DD string (no UTC conversion). */
function localDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Return the local YYYY-MM-DD for Sunday of the week containing `d`. */
function getSundayOf(d: Date): string {
  const dow = d.getDay() // 0=Sun, local timezone
  const sunday = new Date(d)
  sunday.setDate(d.getDate() - dow)
  sunday.setHours(0, 0, 0, 0)
  return localDateStr(sunday)
}

/** Add `n` days to a local YYYY-MM-DD string, returning a local YYYY-MM-DD. */
function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return localDateStr(new Date(y, m - 1, d + n))
}

function formatWeekRange(sunday: string): string {
  const [y, m, d] = sunday.split('-').map(Number)
  const start = new Date(y, m - 1, d)
  const end = new Date(y, m - 1, d + 6)
  const fmt = (date: Date) => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${fmt(start)} – ${fmt(end)}`
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

async function fetchSchedule(weekOf: string): Promise<ScheduleEventDto[]> {
  const res = await fetch(`/api/admin/volunteer-schedule?weekOf=${weekOf}`)
  if (!res.ok) throw new Error('Failed to load schedule')
  return res.json()
}

/** One display block per instructor per start time — merges concurrent classes for the same instructor. */
interface InstructorBlock {
  blockKey: string
  instructorName: string
  startAt: string
  endAt: string
  studentCount: number
  volunteers: Array<{ pike13Id: number; name: string }>
}

/**
 * Pike13 sometimes uses a staff member slot for a class label (e.g. "Make-Up Lab")
 * rather than a real instructor. These should not appear as standalone blocks.
 */
function isClassLabel(name: string): boolean {
  return /\blab\b/i.test(name)
}

function aggregateByInstructor(events: ScheduleEventDto[]): InstructorBlock[] {
  const byInstructor = new Map<string, InstructorBlock>()
  for (const ev of events) {
    const realInstrs = ev.instructors.filter((i) => !isClassLabel(i.name))
    // Use real instructors; fall back to all (including labels) only if no real person present
    const instrs = realInstrs.length > 0 ? realInstrs : ev.instructors

    for (const instr of instrs) {
      const key = `${instr.name}|${ev.startAt}`
      const existing = byInstructor.get(key)
      if (existing) {
        // Same instructor, another concurrent event — add students, extend end time if needed
        existing.studentCount += instr.studentCount
        if (ev.endAt > existing.endAt) existing.endAt = ev.endAt
        for (const vol of ev.volunteers) {
          if (!existing.volunteers.some((v) => v.name === vol.name)) {
            existing.volunteers.push(vol)
          }
        }
      } else {
        byInstructor.set(key, {
          blockKey: key,
          instructorName: instr.name,
          startAt: ev.startAt,
          endAt: ev.endAt,
          studentCount: instr.studentCount,
          volunteers: [...ev.volunteers],
        })
      }
    }
  }
  return [...byInstructor.values()]
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function ScheduleView() {
  const thisSunday = getSundayOf(new Date())
  const maxWeekOf = addDays(thisSunday, 28) // 4 weeks ahead

  const [weekOf, setWeekOf] = useState(() => getSundayOf(new Date()))

  const { data: events = [], isLoading, error } = useQuery<ScheduleEventDto[]>({
    queryKey: ['admin', 'volunteer-schedule', weekOf],
    queryFn: () => fetchSchedule(weekOf),
  })

  // Build 7-day array starting on Sunday
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekOf, i))

  // Group events by day, then by time slot — each event stays separate
  const calendarByDay = useMemo(() => {
    const byDay = new Map<string, Map<string, ScheduleEventDto[]>>()

    for (const ev of events) {
      // Use local date so evening classes don't bleed into the next UTC day
      const day = localDateStr(new Date(ev.startAt))
      // Group by start time only — concurrent classes for the same instructor merge into one block
      const timeKey = ev.startAt

      if (!byDay.has(day)) byDay.set(day, new Map())
      const dayMap = byDay.get(day)!

      if (!dayMap.has(timeKey)) dayMap.set(timeKey, [])
      dayMap.get(timeKey)!.push(ev)
    }

    return byDay
  }, [events])

  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Collapse expanded block on outside click
  useEffect(() => {
    if (!expandedId) return
    function handleOutsideClick() { setExpandedId(null) }
    document.addEventListener('click', handleOutsideClick)
    return () => document.removeEventListener('click', handleOutsideClick)
  }, [expandedId])

  const canGoPrev = weekOf > thisSunday
  const canGoNext = addDays(weekOf, 7) <= maxWeekOf
  const todayIso = localDateStr(new Date())

  return (
    <div>
      {/* Week navigation */}
      <div className="mb-4 flex items-center gap-3">
        <button
          onClick={() => setWeekOf(addDays(weekOf, -7))}
          disabled={!canGoPrev}
          className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          ← Prev
        </button>
        <span className="min-w-[160px] text-center text-sm font-medium text-slate-700">
          {formatWeekRange(weekOf)}
        </span>
        <button
          onClick={() => setWeekOf(addDays(weekOf, 7))}
          disabled={!canGoNext}
          className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Next →
        </button>
        <button
          onClick={() => setWeekOf(getSundayOf(new Date()))}
          className="ml-2 rounded bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-200"
        >
          This week
        </button>
      </div>

      {/* Legend */}
      <div className="mb-4 flex flex-wrap gap-3 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-green-200 border border-green-400" />
          Volunteer assigned
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-red-200 border border-red-400" />
          Volunteer needed (&gt;6 students, none assigned)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-slate-100 border border-slate-300" />
          No volunteer needed
        </span>
      </div>

      {isLoading && <p className="text-slate-500">Loading…</p>}
      {error && <p className="text-red-600">Failed to load schedule. Run a Pike13 sync first.</p>}

      {!isLoading && !error && (
        <div className="overflow-hidden rounded-lg border border-slate-200 shadow-sm">
          {/* Day header row */}
          <div className="grid grid-cols-7 divide-x divide-slate-200 border-b border-slate-200 bg-slate-50">
            {weekDays.map((day, i) => {
              const isToday = day === todayIso
              return (
                <div key={day} className="px-2 py-2 text-center">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    {DAY_LABELS[i]}
                  </div>
                  <div className={`mt-0.5 text-sm font-medium ${isToday ? 'text-blue-600' : 'text-slate-700'}`}>
                    {new Date(day + 'T00:00:00').toLocaleDateString('en-US', {
                      month: 'numeric',
                      day: 'numeric',
                    })}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Calendar body */}
          {calendarByDay.size === 0 ? (
            <div className="bg-white px-6 py-12 text-center">
              <p className="text-slate-500">No upcoming events found for this week.</p>
              <p className="mt-1 text-xs text-slate-400">Run a Pike13 sync to populate the schedule.</p>
            </div>
          ) : (
            <div className="grid min-h-[200px] grid-cols-7 divide-x divide-slate-200 bg-white">
              {weekDays.map((day) => {
                const dayMap = calendarByDay.get(day)
                // Sort time slots chronologically
                const timeSlots = dayMap
                  ? [...dayMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))
                  : []

                return (
                  <div key={day} className="space-y-1.5 p-1.5">
                    {timeSlots.map(([timeKey, slotEvents]) => {
                      const instrBlocks = aggregateByInstructor(slotEvents)
                      return (
                        /* flex-wrap: expanded block claims w-full, others wrap below */
                        <div key={timeKey} className={instrBlocks.length > 1 ? 'flex flex-wrap gap-1' : ''}>
                          {instrBlocks.map((block) => {
                            const hasVolunteer = block.volunteers.length > 0
                            const needsVolunteer = block.studentCount > 6 && !hasVolunteer
                            const isExpanded = expandedId === block.blockKey

                            let colorClass = 'border-slate-300 bg-slate-50 text-slate-700'
                            if (hasVolunteer) colorClass = 'border-green-400 bg-green-50 text-green-900'
                            else if (needsVolunteer) colorClass = 'border-red-400 bg-red-50 text-red-900'

                            return (
                              <div
                                key={block.blockKey}
                                className={`rounded border ${colorClass} px-1.5 py-1 text-xs leading-snug cursor-pointer select-none transition-all duration-150
                                  ${isExpanded
                                    ? 'w-full shadow-md'
                                    : 'overflow-hidden flex-1 min-w-0'
                                  }`}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setExpandedId(isExpanded ? null : block.blockKey)
                                }}
                              >
                                {/* Time — always visible */}
                                <div className="truncate font-semibold tabular-nums">
                                  {formatTime(block.startAt)}–{formatTime(block.endAt)}
                                </div>
                                {/* Instructor — always visible, truncated when compact */}
                                <div className="mt-0.5 truncate font-medium">
                                  {block.instructorName}
                                </div>

                                {/* Expanded detail */}
                                {isExpanded && (
                                  <>
                                    <div className="mt-1">
                                      <span
                                        className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                                          block.studentCount > 6
                                            ? 'bg-red-200 text-red-800'
                                            : block.studentCount > 4
                                              ? 'bg-yellow-200 text-yellow-800'
                                              : 'bg-slate-200 text-slate-700'
                                        }`}
                                      >
                                        {block.studentCount} students
                                      </span>
                                    </div>
                                    {block.volunteers.length > 0 ? (
                                      <div className="mt-0.5 text-[10px] text-green-700">
                                        TA/VA: {block.volunteers.map((v) => v.name).join(', ')}
                                      </div>
                                    ) : (
                                      <div className="mt-0.5 italic text-[10px] text-slate-400">No TA/VA</div>
                                    )}
                                  </>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---- Main page ----

type View = 'summary' | 'detail' | 'schedule'

export function VolunteerHoursPage() {
  const queryClient = useQueryClient()
  const [view, setView] = useState<View>('summary')
  const [summaryFrom, setSummaryFrom] = useState(ytdFrom())
  const [summaryTo, setSummaryTo] = useState(today())
  const [filters, setFilters] = useState<Filters>({
    volunteerName: '',
    category: '',
    from: ytdFrom(),
    to: today(),
  })
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)

  const { data: summary = [], isLoading: summaryLoading, error: summaryError } = useQuery<VolunteerSummaryDto[]>({
    queryKey: ['admin', 'volunteer-hours-summary', summaryFrom, summaryTo],
    queryFn: () => fetchSummary(summaryFrom, summaryTo),
    enabled: view === 'summary',
  })

  const { data: entries = [], isLoading: detailLoading, error: detailError } = useQuery<VolunteerHourDto[]>({
    queryKey: ['admin', 'volunteer-hours', filters],
    queryFn: () => fetchHours(filters),
    enabled: view === 'detail',
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'volunteer-hours'] })
    queryClient.invalidateQueries({ queryKey: ['admin', 'volunteer-hours-summary'] })
  }

  const createMutation = useMutation({
    mutationFn: createHours,
    onSuccess: () => { invalidate(); setShowAddForm(false) },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<HoursFormData> }) => updateHours(id, data),
    onSuccess: () => { invalidate(); setEditingId(null) },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteHours,
    onSuccess: invalidate,
  })

  function handleFilterChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, value } = e.target
    setFilters((prev) => ({ ...prev, [name]: value }))
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Volunteers</h1>
        {view !== 'schedule' && (
          <div className="flex gap-2">
            {view === 'detail' && (
              <button
                onClick={() => exportToCsv(entries, 'volunteer-hours.csv')}
                className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Export CSV
              </button>
            )}
            <button
              onClick={() => { setShowAddForm(true); setEditingId(null) }}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              Add Entry
            </button>
          </div>
        )}
      </div>

      {/* View toggle */}
      <div className="mb-4 flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 w-fit">
        <button
          onClick={() => setView('summary')}
          className={`rounded px-4 py-1.5 text-sm font-medium transition-colors ${
            view === 'summary'
              ? 'bg-white text-slate-800 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Summary
        </button>
        <button
          onClick={() => setView('detail')}
          className={`rounded px-4 py-1.5 text-sm font-medium transition-colors ${
            view === 'detail'
              ? 'bg-white text-slate-800 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Detail
        </button>
        <button
          onClick={() => setView('schedule')}
          className={`rounded px-4 py-1.5 text-sm font-medium transition-colors ${
            view === 'schedule'
              ? 'bg-white text-slate-800 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Schedule
        </button>
      </div>

      {/* Summary view */}
      {view === 'summary' && (
        <>
          <div className="mb-4 flex items-center gap-3">
            <label className="text-sm text-slate-600">From</label>
            <input
              type="date"
              value={summaryFrom}
              onChange={(e) => setSummaryFrom(e.target.value)}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <label className="text-sm text-slate-600">To</label>
            <input
              type="date"
              value={summaryTo}
              onChange={(e) => setSummaryTo(e.target.value)}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {summaryLoading && <p className="text-slate-500">Loading…</p>}
          {summaryError && <p className="text-red-600">Failed to load volunteer summary.</p>}
          {!summaryLoading && <SummaryTable rows={summary} />}
        </>
      )}

      {/* Schedule view */}
      {view === 'schedule' && <ScheduleView />}

      {/* Detail view */}
      {view === 'detail' && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <input
              name="volunteerName"
              placeholder="Volunteer name…"
              value={filters.volunteerName}
              onChange={handleFilterChange}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <select
              name="category"
              value={filters.category}
              onChange={handleFilterChange}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All categories</option>
              <option value="Teaching">Teaching</option>
              <option value="Events">Events</option>
              <option value="Mentoring">Mentoring</option>
              <option value="Admin">Admin</option>
              <option value="Other">Other</option>
            </select>
            <input
              type="date"
              name="from"
              value={filters.from}
              onChange={handleFilterChange}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="date"
              name="to"
              value={filters.to}
              onChange={handleFilterChange}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {showAddForm && (
            <div className="mb-4">
              <EntryForm
                onSubmit={(data) => createMutation.mutate(data)}
                onCancel={() => setShowAddForm(false)}
                isPending={createMutation.isPending}
              />
            </div>
          )}

          {detailLoading && <p className="text-slate-500">Loading…</p>}
          {detailError && <p className="text-red-600">Failed to load volunteer hours.</p>}

          {!detailLoading && entries.length === 0 && !showAddForm && (
            <p className="text-slate-500">No entries.</p>
          )}

          {entries.length > 0 && (
            <div className="space-y-2">
              {entries.map((entry) => (
                <div key={entry.id}>
                  {editingId === entry.id ? (
                    <EntryForm
                      initial={{
                        volunteerName: entry.volunteerName,
                        category: entry.category,
                        hours: entry.hours,
                        description: entry.description ?? '',
                        recordedAt: entry.recordedAt.slice(0, 10),
                      }}
                      onSubmit={(data) => updateMutation.mutate({ id: entry.id, data })}
                      onCancel={() => setEditingId(null)}
                      isPending={updateMutation.isPending}
                    />
                  ) : (
                    <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-800">{entry.volunteerName}</span>
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                            {entry.category}
                          </span>
                          {entry.source === 'pike13' && (
                            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
                              Pike13
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex gap-3 text-sm text-slate-600">
                          <span>{entry.hours} hrs</span>
                          {entry.description && <span>{entry.description}</span>}
                          <span className="text-slate-400">
                            {entry.recordedAt.slice(0, 10)}
                            {entry.source === 'pike13' && (() => {
                              const start = new Date(entry.recordedAt)
                              const end = new Date(start.getTime() + entry.hours * 3_600_000)
                              const fmt = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
                              return <span className="ml-1">· {fmt(start)}–{fmt(end)}</span>
                            })()}
                          </span>
                        </div>
                      </div>
                      <div className="ml-4 flex shrink-0 gap-2">
                        <button
                          onClick={() => { setEditingId(entry.id); setShowAddForm(false) }}
                          className="rounded bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deleteMutation.mutate(entry.id)}
                          disabled={entry.source === 'pike13' || deleteMutation.isPending}
                          className="rounded bg-red-50 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
