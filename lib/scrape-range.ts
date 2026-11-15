// Which FMCSA register days a scraper run covers. FMCSA publishes only on business
// days, so a range expands to its weekdays (a holiday is simply reported by the script
// and the run moves on to the next day).

export const MAX_RANGE_DAYS = 31

const ISO = /^\d{4}-\d{2}-\d{2}$/

function parse(s: string): Date | null {
  if (!ISO.test(s)) return null
  const d = new Date(`${s}T00:00:00Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : d
}

/** Weekdays from `from` to `to`, oldest first, or an error message. */
export function weekdaysInRange(from: string, to: string): { ok: true; dates: string[] } | { ok: false; error: string } {
  const a = parse(from)
  const b = parse(to)
  if (!a || !b) return { ok: false, error: "Pick a valid start and end date." }
  if (a > b) return { ok: false, error: "The start date must be on or before the end date." }
  const today = new Date().toISOString().slice(0, 10)
  if (to > today) return { ok: false, error: "The end date can't be in the future." }
  if ((b.getTime() - a.getTime()) / 86_400_000 + 1 > MAX_RANGE_DAYS) {
    return { ok: false, error: `Pick at most ${MAX_RANGE_DAYS} days at a time.` }
  }
  const dates: string[] = []
  for (let d = new Date(a); d <= b; d.setUTCDate(d.getUTCDate() + 1)) {
    const wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6) dates.push(d.toISOString().slice(0, 10))
  }
  if (dates.length === 0) return { ok: false, error: "That range has only weekend days. FMCSA publishes on business days." }
  return { ok: true, dates }
}
