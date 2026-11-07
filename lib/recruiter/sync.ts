// Reply sync for the Recruiter tab: reads new mail in info@loadlinkers.co
// over IMAP (read-only: EXAMINE + BODY.PEEK, nothing is flagged, moved or
// deleted), matches replies to recruits and records attachment/link
// metadata. Attachment bytes are never downloaded here.
import type { ImapFlow } from "imapflow"
import { createAdminClient } from "@/lib/supabase/admin"
import { RECRUIT_MAILBOX_NAME, RECRUIT_SYNC_KEY, recruitImap, recruitMailbox } from "./mail"
import { htmlToText, summariseStructure, type StructNode } from "./mime"
import { classifyLink, extractUrls, isIgnorableLink, isVideoProvider } from "./links"

type Admin = ReturnType<typeof createAdminClient>

const MAX_PER_RUN = 40
const TEXT_MAX = 200_000
const HTML_MAX = 500_000

export interface RecruitSyncResult {
  checked: number
  imported: number
  media: number
  remaining: number
  baselined: boolean
}

async function readPart(client: ImapFlow, uid: number, part: string, maxBytes: number): Promise<string> {
  const dl = await client.download(String(uid), part, { uid: true, maxBytes })
  if (!dl?.content) return ""
  const chunks: Buffer[] = []
  for await (const c of dl.content) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c))
  return Buffer.concat(chunks).toString("utf8")
}

function idList(v: string | null | undefined): string[] {
  return (v ?? "").match(/<[^<>\s]+>/g) ?? []
}

/** Pull a header value out of the raw header block imapflow returns. */
export function headerValue(raw: string, name: string): string | null {
  const unfolded = raw.replace(/\r?\n[ \t]+/g, " ")
  const m = unfolded.match(new RegExp(`^${name}:\\s*(.*)$`, "im"))
  return m ? m[1].trim() : null
}

const OWN_DOMAINS = () => Array.from(new Set(["loadlinkers.co", recruitMailbox().split("@")[1]].filter(Boolean))) as string[]

/** What the stage becomes after a reply. Later stages are never moved back. */
export function stageAfterReply(current: string, hasVideo: boolean): string {
  if (["interview", "hired", "rejected"].includes(current)) return current
  if (hasVideo) return "video_received"
  if (current === "video_received") return current
  return "replied"
}

async function findRecruit(admin: Admin, from: string, refs: string[]): Promise<{ id: string; stage: string } | null> {
  const { data } = await (admin.from("recruits") as any).select("id, stage").eq("email", from).maybeSingle()
  if (data) return data
  if (refs.length === 0) return null
  const { data: msg } = await (admin.from("recruit_messages") as any)
    .select("recruit_id")
    .in("message_id", refs)
    .limit(1)
    .maybeSingle()
  if (!msg) return null
  const { data: r } = await (admin.from("recruits") as any).select("id, stage").eq("id", msg.recruit_id).maybeSingle()
  return r ?? null
}

export async function syncRecruitInbox(): Promise<RecruitSyncResult> {
  const admin = createAdminClient()
  const result: RecruitSyncResult = { checked: 0, imported: 0, media: 0, remaining: 0, baselined: false }
  const { data: stateRaw } = await (admin.from("email_sync_state") as any)
    .select("last_uid, uid_validity")
    .eq("id", RECRUIT_SYNC_KEY)
    .maybeSingle()
  const state = stateRaw as { last_uid: number; uid_validity: number | null } | null
  let lastUid = state?.last_uid ?? 0

  const client = recruitImap()
  const saveState = (patch: Record<string, unknown>) =>
    (admin.from("email_sync_state") as any).upsert({ id: RECRUIT_SYNC_KEY, last_synced_at: new Date().toISOString(), ...patch })

  try {
    await client.connect()
    const lock = await client.getMailboxLock(RECRUIT_MAILBOX_NAME, { readOnly: true })
    try {
      const mailbox = client.mailbox
      if (!mailbox) throw new Error("Could not open INBOX")
      const uidValidity = Number(mailbox.uidValidity)

      // First run (or UIDs reset by the server): start from "now", don't import history.
      if (!state || state.uid_validity == null || Number(state.uid_validity) !== uidValidity) {
        const start = Math.max(0, Number(mailbox.uidNext) - 1)
        await saveState({ last_uid: start, uid_validity: uidValidity, last_imported: 0, last_error: null })
        result.baselined = true
        return result
      }

      let uids = ((await client.search({ uid: `${lastUid + 1}:*` }, { uid: true })) || []) as number[]
      uids = uids.filter((u) => u > lastUid).sort((a, b) => a - b)
      const batch = uids.slice(0, MAX_PER_RUN)
      result.remaining = uids.length - batch.length

      let failure: Error | null = null
      for (const uid of batch) {
        try {
          await importOne(admin, client, uid, result)
        } catch (err) {
          failure = err instanceof Error ? err : new Error(String(err))
          break
        }
        result.checked++
        lastUid = uid
      }
      await saveState({ last_uid: lastUid, uid_validity: uidValidity, last_imported: result.imported, last_error: failure?.message ?? null })
      if (failure) throw failure
    } finally {
      lock.release()
    }
  } catch (err) {
    await saveState({ last_uid: lastUid, last_error: err instanceof Error ? err.message : String(err) })
    throw err
  } finally {
    await client.logout().catch(() => {})
  }
  return result
}

async function importOne(admin: Admin, client: ImapFlow, uid: number, result: RecruitSyncResult) {
  const msg = await client.fetchOne(
    String(uid),
    { envelope: true, bodyStructure: true, internalDate: true, headers: ["message-id", "in-reply-to", "references"] },
    { uid: true },
  )
  if (!msg || !msg.envelope) return
  const from = (msg.envelope.from?.[0]?.address ?? "").trim().toLowerCase()
  if (!from || from === recruitMailbox()) return

  const rawHeaders = msg.headers ? msg.headers.toString("utf8") : ""
  const messageId = msg.envelope.messageId || headerValue(rawHeaders, "message-id") || `<imap-${uid}@${RECRUIT_SYNC_KEY}>`
  const inReplyTo = msg.envelope.inReplyTo || headerValue(rawHeaders, "in-reply-to")
  const references = headerValue(rawHeaders, "references")
  const refs = Array.from(new Set([...idList(inReplyTo), ...idList(references)]))

  const recruit = await findRecruit(admin, from, refs)
  if (!recruit) return // Not a candidate: left alone in the mailbox.

  const { data: dup } = await (admin.from("recruit_messages") as any).select("id").eq("message_id", messageId).maybeSingle()
  if (dup) return

  const summary = summariseStructure((msg.bodyStructure ?? { type: "text/plain" }) as StructNode)
  const text = summary.textPart ? await readPart(client, uid, summary.textPart.part, TEXT_MAX) : ""
  const html = summary.htmlPart ? await readPart(client, uid, summary.htmlPart.part, HTML_MAX) : ""
  const receivedAt = (msg.internalDate ? new Date(msg.internalDate) : msg.envelope.date ? new Date(msg.envelope.date) : new Date()).toISOString()

  const { data: inserted, error } = await (admin.from("recruit_messages") as any)
    .insert({
      recruit_id: recruit.id,
      direction: "inbound",
      subject: msg.envelope.subject ?? null,
      body_text: text || (html ? htmlToText(html) : ""),
      body_html: html || null,
      message_id: messageId,
      in_reply_to: inReplyTo,
      references_header: references,
      imap_uid: uid,
      received_at: receivedAt,
    })
    .select("id")
    .single()
  if (error) {
    if (/duplicate key/i.test(error.message)) return
    throw new Error(error.message)
  }
  result.imported++

  // Links already in emails we sent this candidate (quoted back in replies) are not their media.
  const { data: sent } = await (admin.from("recruit_messages") as any)
    .select("body_text, body_html")
    .eq("recruit_id", recruit.id)
    .eq("direction", "outbound")
  const sentLinks = new Set<string>()
  for (const s of (sent ?? []) as Array<{ body_text: string | null; body_html: string | null }>) {
    for (const u of extractUrls(s.body_text, s.body_html)) sentLinks.add(u)
  }

  const rows: Record<string, unknown>[] = []
  for (const a of summary.attachments) {
    rows.push({
      recruit_id: recruit.id,
      message_id: inserted.id,
      source_type: "attachment",
      provider: "attachment",
      file_name: a.file_name,
      mime_type: a.mime_type,
      size_bytes: a.size_bytes,
      imap_uid: uid,
      imap_mailbox: RECRUIT_MAILBOX_NAME,
      mime_part_id: a.part,
      status: a.status,
    })
  }
  for (const url of extractUrls(text, html)) {
    if (isIgnorableLink(url, OWN_DOMAINS(), sentLinks)) continue
    const c = classifyLink(url)
    rows.push({
      recruit_id: recruit.id,
      message_id: inserted.id,
      source_type: "link",
      provider: c.provider,
      original_url: c.original_url.slice(0, 2000),
      embed_url: c.embed_url,
      status: c.status,
    })
  }
  if (rows.length) {
    const { error: mErr } = await (admin.from("recruit_media") as any).insert(rows)
    if (mErr) throw new Error(mErr.message)
    result.media += rows.length
  }

  // Attachments the candidate sent, or a link to a known video host, count as "video received".
  const hasVideo =
    summary.attachments.some((a) => a.status === "available") ||
    rows.some((r) => r.source_type === "link" && isVideoProvider(r.provider as any))

  await (admin.from("recruits") as any)
    .update({
      stage: stageAfterReply(recruit.stage, hasVideo),
      last_reply_at: receivedAt,
      follow_up_due_at: null,
      unread: true,
    })
    .eq("id", recruit.id)
}
