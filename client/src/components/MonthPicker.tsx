import { useSearch, useLocation } from 'wouter'
import { getDefaultMonth } from '../lib/utils'

/** Returns the last N calendar months as YYYY-MM strings, most recent first. */
function getMonthOptions(count = 12): string[] {
  const options: string[] = []
  const d = new Date()
  for (let i = 0; i < count; i++) {
    options.push(d.toISOString().slice(0, 7))
    d.setMonth(d.getMonth() - 1)
  }
  return options
}

function formatMonthLabel(ym: string): string {
  const [year, month] = ym.split('-').map(Number)
  return new Date(year, month - 1, 1).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
  })
}

interface MonthPickerProps {
  className?: string
}

export function MonthPicker({ className }: MonthPickerProps) {
  const search = useSearch()
  const [, setLocation] = useLocation()

  const params = new URLSearchParams(search)
  const selected = params.get('month') ?? getDefaultMonth()
  const options = getMonthOptions(12)

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newParams = new URLSearchParams(search)
    newParams.set('month', e.target.value)
    setLocation('?' + newParams.toString())
  }

  return (
    <select
      value={selected}
      onChange={handleChange}
      className={`select ${className ?? ''}`}
      style={{ width: 'auto' }}
      aria-label="Select month"
    >
      {options.map((ym) => (
        <option key={ym} value={ym}>
          {formatMonthLabel(ym)}
        </option>
      ))}
    </select>
  )
}
