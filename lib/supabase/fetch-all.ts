// Supabase's API returns at most 1000 rows per request, no matter how many match. This reads
// every page (1000 at a time) so lists don't silently stop at 1000.
//
// `build` must return a fresh query each call and include a stable order (add a unique column
// such as id as a tie-breaker), otherwise rows can repeat or be skipped between pages.
const PAGE = 1000
const MAX_PAGES = 100 // safety stop: 100,000 rows

export async function fetchAll<T = any>(
  build: () => { range(from: number, to: number): PromiseLike<{ data: any[] | null; error: { message: string } | null }> },
): Promise<T[]> {
  const out: T[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await build().range(page * PAGE, page * PAGE + PAGE - 1)
    if (error || !data) break
    out.push(...(data as T[]))
    if (data.length < PAGE) break
  }
  return out
}
