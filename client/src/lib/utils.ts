import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * The default month for review-related views, as `YYYY-MM`.
 *
 * Progress reports follow a "review the previous month" cadence: in June you
 * write May's reports. So the default selected month is the previous calendar
 * month, not the current one. Building from year/month integers avoids
 * day-of-month overflow and handles the January → previous December rollover.
 */
export function getDefaultMonth(): string {
  const now = new Date()
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`
}
