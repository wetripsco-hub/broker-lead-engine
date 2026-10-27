// Supabase's API returns at most 1000 rows per request, no matter how many match. This reads
// every page (1000 at a time) so lists don't silently stop at 1000.
//
// `build` must return a fresh query each call and include a stable order (add a unique column
// such as id as a tie-breaker), otherwise rows can repeat or be skipped between pages.
//
// The first page is read alone; if it is full, the next pages are requested a few at a time in
// parallel (each request is a round trip, so this is much faster than one after another).
const PAGE = 1000
const MAX_PAGES = 100 // safety stop: 100,000 rows
const PARALLEL = 3

type PageResult = { data: any[] | null; error: { message: string } | null }

export async function fetchAll<T = any>(
  build: () => { range(from: number, to: number): PromiseLike<PageResult> },
): Promise<T[]> {
  const readPage = (page: number) => build().range(page * PAGE, page * PAGE + PAGE - 1)

  const first = await readPage(0)
  if (first.error || !first.data) return []
  const out: T[] = [...(first.data as T[])]
  if (first.data.length < PAGE) return out

  for (let start = 1; start < MAX_PAGES; start += PARALLEL) {
    const batch = await Promise.all(Array.from({ length: PARALLEL }, (_, i) => readPage(start + i)))
    for (const r of batch) {
      if (r.error || !r.data) return out
      out.push(...(r.data as T[]))
      if (r.data.length < PAGE) return out
    }
  }
  return out
}
