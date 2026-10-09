import { buildLeadsWorkbook, exportFileName, workbookToBuffer, type ExportMode, type ExportRow } from "./export"

const MAX_IDS = 5000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface AuditEntry {
  userId: string
  userEmail: string | null
  mode: ExportMode
  rowCount: number
  fileName: string
  filters: Record<string, unknown> | null
}

/** Everything the handler needs from the outside world, so it can be tested without a server. */
export interface ExportDeps {
  getUser(): Promise<{ id: string; email: string | null } | null>
  /** Must answer from the database, never from anything the client sent. */
  isAdmin(userId: string): Promise<boolean>
  /** Reads with the caller's own session, so row-level security applies. */
  loadRows(ids: string[] | null): Promise<ExportRow[]>
  /** Returns false if the audit record could not be written. */
  recordAudit(entry: AuditEntry): Promise<boolean>
  now(): Date
}

export type ExportResult =
  | { ok: false; status: 400 | 401 | 403 | 500; error: string }
  | { ok: true; buffer: Buffer; fileName: string; rowCount: number }

const fail = (status: 400 | 401 | 403 | 500, error: string): ExportResult => ({ ok: false, status, error })

function cleanFilters(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 12)) {
    if (typeof v === "string") out[k.slice(0, 40)] = v.slice(0, 200)
    else if (typeof v === "boolean" || typeof v === "number") out[k.slice(0, 40)] = v
  }
  return out
}

/**
 * POST /api/leads/export. Order matters: sign-in, then the admin check (from the
 * database), and only then any data is read.
 */
export async function handleExport(body: unknown, deps: ExportDeps): Promise<ExportResult> {
  const user = await deps.getUser()
  if (!user) return fail(401, "Not signed in")
  if (!(await deps.isAdmin(user.id))) return fail(403, "Only admins can export leads")

  const b = (body ?? {}) as { mode?: unknown; ids?: unknown; filters?: unknown }
  const mode = b.mode
  if (mode !== "all" && mode !== "filtered" && mode !== "selected") return fail(400, "Unknown export option")

  let ids: string[] | null = null
  if (mode !== "all") {
    if (!Array.isArray(b.ids) || b.ids.length === 0) return fail(400, mode === "selected" ? "No leads selected" : "No leads match the current filter")
    if (b.ids.length > MAX_IDS) return fail(400, `Too many leads in one export (max ${MAX_IDS})`)
    if (!b.ids.every((x) => typeof x === "string" && UUID.test(x))) return fail(400, "Invalid lead ids")
    ids = b.ids as string[]
  }

  let rows: ExportRow[]
  try {
    rows = await deps.loadRows(ids)
  } catch {
    return fail(500, "Couldn't read the leads. Nothing was exported.")
  }

  const now = deps.now()
  const fileName = exportFileName(mode, now)
  let buffer: Buffer
  try {
    buffer = await workbookToBuffer(buildLeadsWorkbook(rows))
  } catch {
    return fail(500, "Couldn't build the Excel file.")
  }

  // The audit record comes first: no record, no file.
  const recorded = await deps.recordAudit({
    userId: user.id,
    userEmail: user.email,
    mode,
    rowCount: rows.length,
    fileName,
    filters: cleanFilters(b.filters),
  })
  if (!recorded) return fail(500, "Couldn't record this export in the audit log, so nothing was downloaded.")

  return { ok: true, buffer, fileName, rowCount: rows.length }
}
