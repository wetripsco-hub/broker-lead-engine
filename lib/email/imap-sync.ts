import { ImapFlow } from "imapflow"
import { createAdminClient } from "@/lib/supabase/admin"
import { processInboundMessage } from "@/lib/email/inbound"

// Bound one run so a big backlog can't blow the function timeout; the
// cursor only advances past what was processed, the next run continues.
const MAX_PER_RUN = 50
// A brand-new sync (no cursor yet) only looks this far back instead of
// importing the mailbox's entire history as "unmatched" mail.
const FIRST_SYNC_DAYS = 7

export interface SyncResult {
  imported: number
  duplicates: number
  skipped: number
  remaining: number
  lastUid: number
}

export function imapConfigured(): boolean {
  return Boolean(process.env.IMAP_HOST && process.env.IMAP_USER && process.env.IMAP_PASS)
}

export async function syncInbox(): Promise<SyncResult> {
  const host = process.env.IMAP_HOST
  const user = process.env.IMAP_USER
  const pass = process.env.IMAP_PASS
  const port = Number(process.env.IMAP_PORT ?? 993)
  if (!host || !user || !pass) {
    throw new Error("IMAP_HOST, IMAP_USER and IMAP_PASS must all be set")
  }

  const admin = createAdminClient()
  const { data: stateRaw } = await (admin.from("email_sync_state") as any)
    .select("last_uid, uid_validity")
    .eq("id", "inbox")
    .maybeSingle()
  const state = stateRaw as { last_uid: number; uid_validity: number | null } | null

  const client = new ImapFlow({
    host,
    port,
    secure: port === 993,
    auth: { user, pass },
    logger: false,
  })

  const result: SyncResult = { imported: 0, duplicates: 0, skipped: 0, remaining: 0, lastUid: state?.last_uid ?? 0 }

  try {
    await client.connect()
    const lock = await client.getMailboxLock("INBOX")
    try {
      const mailbox = client.mailbox
      if (!mailbox) throw new Error("Could not open INBOX")
      const uidValidity = Number(mailbox.uidValidity)

      // If the server reassigned UIDs, our cursor is meaningless — start over.
      // Message-ID dedup makes re-reading recent mail harmless.
      let lastUid = state?.last_uid ?? 0
      if (state?.uid_validity != null && state.uid_validity !== uidValidity) lastUid = 0

      let uids: number[]
      if (lastUid === 0) {
        const since = new Date(Date.now() - FIRST_SYNC_DAYS * 86_400_000)
        uids = ((await client.search({ since }, { uid: true })) || []) as number[]
        if (uids.length === 0) lastUid = Math.max(0, Number(mailbox.uidNext) - 1)
      } else {
        // "N:*" always returns the newest message even if its UID < N.
        uids = ((await client.search({ uid: `${lastUid + 1}:*` }, { uid: true })) || []) as number[]
        uids = uids.filter((u) => u > lastUid)
      }
      uids.sort((a, b) => a - b)

      const batch = uids.slice(0, MAX_PER_RUN)
      result.remaining = uids.length - batch.length

      let failure: Error | null = null
      for (const uid of batch) {
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true })
        if (msg && msg.source) {
          try {
            const r = await processInboundMessage(admin, msg.source, { mailboxAddress: user })
            if (r.outcome === "imported") result.imported++
            else if (r.outcome === "duplicate") result.duplicates++
            else result.skipped++
          } catch (err) {
            // Database error: stop here WITHOUT advancing past this message.
            failure = err instanceof Error ? err : new Error(String(err))
            break
          }
        }
        lastUid = uid
      }

      result.lastUid = lastUid
      await (admin.from("email_sync_state") as any).upsert({
        id: "inbox",
        last_uid: lastUid,
        uid_validity: uidValidity,
        last_synced_at: new Date().toISOString(),
        last_imported: result.imported,
        last_error: failure ? failure.message : null,
      })
      if (failure) throw failure
    } finally {
      lock.release()
    }
  } catch (err) {
    await (admin.from("email_sync_state") as any).upsert({
      id: "inbox",
      last_uid: result.lastUid,
      last_synced_at: new Date().toISOString(),
      last_error: err instanceof Error ? err.message : String(err),
    })
    throw err
  } finally {
    await client.logout().catch(() => {})
  }

  return result
}
