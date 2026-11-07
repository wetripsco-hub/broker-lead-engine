"use server"

import { randomUUID } from "crypto"
import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { recruiterAdmin } from "@/lib/recruiter/auth"
import { EMAIL_RE, normaliseEmail, parseRecruitCsv, type CsvPreview, type CsvRow } from "@/lib/recruiter/csv"
import { renderTemplate, textToHtml } from "@/lib/recruiter/template"
import { newMessageId, recruitImapConfigured, recruitSmtpConfigured, sendRecruitEmail } from "@/lib/recruiter/mail"
import { processOne } from "@/lib/recruiter/send-queue"
import { syncRecruitInbox } from "@/lib/recruiter/sync"
import { RECRUIT_STAGES, type RecruitStage, type ThreadData, type BatchProgress } from "./types"

const DENIED = { error: "Admin access required" }

async function db() {
  // RLS on every recruiter table only lets admins through; this is the second lock.
  return createClient()
}

async function allRecruitEmails(): Promise<Set<string>> {
  const supabase = await db()
  const out = new Set<string>()
  for (let from = 0; ; from += 1000) {
    const { data } = await (supabase.from("recruits") as any).select("email").range(from, from + 999)
    for (const r of (data ?? []) as Array<{ email: string }>) out.add(r.email)
    if (!data || data.length < 1000) break
  }
  return out
}

// ── CSV ───────────────────────────────────────────────────────────────────
export async function previewRecruitCsv(text: string): Promise<CsvPreview | { error: string }> {
  if (!(await recruiterAdmin())) return DENIED
  if (text.length > 5_000_000) return { error: "File is too large (5 MB max)." }
  return parseRecruitCsv(text, await allRecruitEmails())
}

export async function importRecruits(rows: CsvRow[], source: string): Promise<{ error: string | null; imported: number }> {
  if (!(await recruiterAdmin())) return { ...DENIED, imported: 0 }
  const existing = await allRecruitEmails()
  const seen = new Set<string>()
  const clean = rows
    .map((r) => ({ name: String(r.name ?? "").trim().slice(0, 200), email: normaliseEmail(String(r.email ?? "")) }))
    .filter((r) => EMAIL_RE.test(r.email) && !existing.has(r.email) && !seen.has(r.email) && seen.add(r.email))
    .map((r) => ({ ...r, source: source.slice(0, 200) || null, stage: "new" }))
  if (clean.length === 0) return { error: null, imported: 0 }
  const supabase = await db()
  let imported = 0
  for (let i = 0; i < clean.length; i += 500) {
    const { data, error } = await (supabase.from("recruits") as any)
      .upsert(clean.slice(i, i + 500), { onConflict: "email", ignoreDuplicates: true })
      .select("id")
    if (error) return { error: error.message, imported }
    imported += data?.length ?? 0
  }
  revalidatePath("/recruiter")
  return { error: null, imported }
}

// ── Templates ─────────────────────────────────────────────────────────────
export async function saveRecruitTemplate(t: { id?: string; name: string; subject: string; body: string }): Promise<{ error: string | null }> {
  if (!(await recruiterAdmin())) return DENIED
  const row = { name: t.name.trim(), subject: t.subject.trim(), body: t.body }
  if (!row.name || !row.subject || !row.body.trim()) return { error: "Name, subject and body are required" }
  const supabase = await db()
  const { error } = t.id
    ? await (supabase.from("recruit_templates") as any).update(row).eq("id", t.id)
    : await (supabase.from("recruit_templates") as any).insert(row)
  if (error) return { error: error.message }
  revalidatePath("/recruiter")
  return { error: null }
}

export async function deleteRecruitTemplate(id: string): Promise<{ error: string | null }> {
  if (!(await recruiterAdmin())) return DENIED
  const supabase = await db()
  const { error } = await (supabase.from("recruit_templates") as any).delete().eq("id", id)
  if (error) return { error: error.message }
  revalidatePath("/recruiter")
  return { error: null }
}

// ── Sending (queued, throttled) ───────────────────────────────────────────
export async function queueRecruitEmails(
  recruitIds: string[],
  templateId: string,
): Promise<{ error: string | null; batchId?: string; queued?: number; skipped?: number }> {
  if (!(await recruiterAdmin())) return DENIED
  if (!recruitSmtpConfigured()) return { error: "Recruiter email is not set up yet (RECRUIT_SMTP_* in Vercel)." }
  const ids = Array.from(new Set(recruitIds)).slice(0, 2000)
  if (ids.length === 0) return { error: "Select at least one recruit" }
  const supabase = await db()
  const { data: tpl } = await (supabase.from("recruit_templates") as any).select("id, subject, body").eq("id", templateId).maybeSingle()
  if (!tpl) return { error: "Template not found" }

  const recruits: Array<{ id: string; name: string }> = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await (supabase.from("recruits") as any).select("id, name").in("id", ids.slice(i, i + 200))
    recruits.push(...((data ?? []) as any[]))
  }
  // Don't queue the same person twice while an earlier email is still waiting.
  const waiting = new Set<string>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await (supabase.from("recruit_send_queue") as any)
      .select("recruit_id")
      .in("recruit_id", ids.slice(i, i + 200))
      .in("status", ["queued", "sending"])
    for (const r of (data ?? []) as any[]) waiting.add(r.recruit_id)
  }
  const batchId = randomUUID()
  const base = Date.now()
  const rows = recruits
    .filter((r) => !waiting.has(r.id))
    .map((r, i) => ({
      batch_id: batchId,
      recruit_id: r.id,
      template_id: tpl.id,
      subject: renderTemplate(tpl.subject, r),
      body: renderTemplate(tpl.body, r),
      // Keeps the order the admin saw (created_at is the queue order).
      created_at: new Date(base + i).toISOString(),
    }))
  if (rows.length === 0) return { error: "Everyone selected already has an email waiting to send" }
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await (supabase.from("recruit_send_queue") as any).insert(rows.slice(i, i + 500))
    if (error) return { error: error.message }
  }
  return { error: null, batchId, queued: rows.length, skipped: recruits.length - rows.length }
}

export async function batchProgress(batchId: string | null): Promise<BatchProgress | { error: string }> {
  if (!(await recruiterAdmin())) return DENIED
  const supabase = await db()
  let q = (supabase.from("recruit_send_queue") as any).select("id, status, error, recruit_id, recruits(name, email)")
  q = batchId ? q.eq("batch_id", batchId) : q.in("status", ["queued", "sending"])
  const { data } = await q.order("created_at").limit(2000)
  const rows = (data ?? []) as any[]
  const by = (s: string) => rows.filter((r) => r.status === s).length
  return {
    total: rows.length,
    queued: by("queued"),
    sending: by("sending"),
    sent: by("sent"),
    failed: by("failed"),
    cancelled: by("cancelled"),
    failures: rows
      .filter((r) => r.status === "failed")
      .slice(0, 50)
      .map((r) => ({ email: r.recruits?.email ?? "", error: r.error ?? "Failed" })),
  }
}

/** Called by the open Recruiter page every few seconds while a batch is sending. */
export async function tickSendQueue(batchId: string | null): Promise<BatchProgress | { error: string }> {
  if (!(await recruiterAdmin())) return DENIED
  if (recruitSmtpConfigured()) {
    try {
      await processOne(createAdminClient())
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  }
  return batchProgress(batchId)
}

export async function cancelBatch(batchId: string): Promise<{ error: string | null }> {
  if (!(await recruiterAdmin())) return DENIED
  const supabase = await db()
  const { error } = await (supabase.from("recruit_send_queue") as any).update({ status: "cancelled" }).eq("batch_id", batchId).eq("status", "queued")
  return { error: error?.message ?? null }
}

export async function retryFailed(batchId: string): Promise<{ error: string | null }> {
  if (!(await recruiterAdmin())) return DENIED
  const supabase = await db()
  const { error } = await (supabase.from("recruit_send_queue") as any)
    .update({ status: "queued", error: null, claimed_at: null })
    .eq("batch_id", batchId)
    .eq("status", "failed")
  return { error: error?.message ?? null }
}

// ── Reply sync ────────────────────────────────────────────────────────────
export async function syncRecruitReplies(): Promise<{ error: string | null; imported?: number; baselined?: boolean }> {
  if (!(await recruiterAdmin())) return DENIED
  if (!recruitImapConfigured()) return { error: "Recruiter inbox is not set up yet (RECRUIT_IMAP_* in Vercel)." }
  try {
    const r = await syncRecruitInbox()
    revalidatePath("/recruiter")
    return { error: null, imported: r.imported, baselined: r.baselined }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

// ── Thread ────────────────────────────────────────────────────────────────
export async function loadThread(recruitId: string): Promise<ThreadData | { error: string }> {
  if (!(await recruiterAdmin())) return DENIED
  const supabase = await db()
  const [{ data: recruit }, { data: messages }, { data: media }] = await Promise.all([
    (supabase.from("recruits") as any).select("*").eq("id", recruitId).maybeSingle(),
    (supabase.from("recruit_messages") as any)
      .select("id, direction, subject, body_text, message_id, sent_at, received_at, created_at")
      .eq("recruit_id", recruitId)
      .order("created_at"),
    (supabase.from("recruit_media") as any)
      .select("id, message_id, source_type, provider, original_url, embed_url, file_name, mime_type, size_bytes, status")
      .eq("recruit_id", recruitId),
  ])
  if (!recruit) return { error: "Recruit not found" }
  if (recruit.unread) await (supabase.from("recruits") as any).update({ unread: false }).eq("id", recruitId)
  return { recruit: { ...recruit, unread: false }, messages: messages ?? [], media: media ?? [] }
}

export async function sendRecruitReply(recruitId: string, subject: string, body: string): Promise<{ error: string | null }> {
  if (!(await recruiterAdmin())) return DENIED
  if (!recruitSmtpConfigured()) return { error: "Recruiter email is not set up yet (RECRUIT_SMTP_* in Vercel)." }
  if (!body.trim()) return { error: "Write a message first" }
  const supabase = await db()
  const { data: recruit } = await (supabase.from("recruits") as any).select("id, name, email, stage").eq("id", recruitId).maybeSingle()
  if (!recruit) return { error: "Recruit not found" }
  const { data: msgs } = await (supabase.from("recruit_messages") as any)
    .select("direction, subject, message_id, references_header")
    .eq("recruit_id", recruitId)
    .order("created_at", { ascending: false })
    .limit(20)
  const list = (msgs ?? []) as Array<{ direction: string; subject: string | null; message_id: string | null; references_header: string | null }>
  // Thread on the candidate's latest email (or our latest, if they never wrote).
  const parent = list.find((m) => m.direction === "inbound" && m.message_id) ?? list.find((m) => m.message_id)
  const refs = parent
    ? Array.from(new Set([...(parent.references_header?.match(/<[^<>\s]+>/g) ?? []), parent.message_id!])).slice(-20).join(" ")
    : null
  const baseSubject = subject.trim() || parent?.subject || "Loadlinkers"
  const finalSubject = /^re:/i.test(baseSubject) || !parent ? baseSubject : `Re: ${baseSubject}`
  const text = renderTemplate(body, recruit)
  const messageId = newMessageId()
  try {
    await sendRecruitEmail({
      to: recruit.email,
      subject: finalSubject,
      text,
      html: textToHtml(text),
      messageId,
      inReplyTo: parent?.message_id ?? null,
      references: refs,
    })
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
  const now = new Date().toISOString()
  await (supabase.from("recruit_messages") as any).insert({
    recruit_id: recruitId,
    direction: "outbound",
    subject: finalSubject,
    body_text: text,
    body_html: textToHtml(text),
    message_id: messageId,
    in_reply_to: parent?.message_id ?? null,
    references_header: refs,
    sent_at: now,
  })
  await (supabase.from("recruits") as any)
    .update({ last_emailed_at: now, ...(recruit.stage === "new" ? { stage: "emailed" } : {}) })
    .eq("id", recruitId)
  revalidatePath("/recruiter")
  return { error: null }
}

// ── Pipeline ──────────────────────────────────────────────────────────────
export async function setRecruitStage(recruitId: string, stage: RecruitStage): Promise<{ error: string | null }> {
  if (!(await recruiterAdmin())) return DENIED
  if (!RECRUIT_STAGES.includes(stage)) return { error: "Unknown stage" }
  const supabase = await db()
  const { error } = await (supabase.from("recruits") as any).update({ stage }).eq("id", recruitId)
  if (error) return { error: error.message }
  revalidatePath("/recruiter")
  return { error: null }
}

export async function saveRecruitNotes(recruitId: string, notes: string): Promise<{ error: string | null }> {
  if (!(await recruiterAdmin())) return DENIED
  const supabase = await db()
  const { error } = await (supabase.from("recruits") as any).update({ notes: notes.slice(0, 10_000) }).eq("id", recruitId)
  return { error: error?.message ?? null }
}

/** After the existing createAgent flow succeeds: link the new agent row and mark hired. */
export async function linkHiredRecruit(recruitId: string, email: string): Promise<{ error: string | null }> {
  if (!(await recruiterAdmin())) return DENIED
  const supabase = await db()
  const { data: agent } = await (supabase.from("agents") as any)
    .select("id")
    .eq("email", email.trim().toLowerCase())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!agent) return { error: "Agent account was not found after creating it" }
  const { error } = await (supabase.from("recruits") as any).update({ agent_id: agent.id, stage: "hired" }).eq("id", recruitId)
  if (error) return { error: error.message }
  revalidatePath("/recruiter")
  return { error: null }
}
