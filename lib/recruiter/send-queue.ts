// Throttled sending for recruiter emails. Rows wait in recruit_send_queue;
// recruit_claim_send hands out one at a time, only when the spacing
// (20–30 s) and the hourly cap allow it.
import { createAdminClient } from "@/lib/supabase/admin"
import { newMessageId, recruitImapConfigured, sendPace, sendRecruitEmail } from "./mail"
import { textToHtml } from "./template"
import { RECRUIT_SYNC_KEY } from "./mail"
import { syncRecruitInbox } from "./sync"

type Admin = ReturnType<typeof createAdminClient>

export const FOLLOW_UP_DAYS = 3

export interface TickResult {
  sent: number
  failed: number
  queued: number
  waiting: boolean
}

async function ensureSyncBaseline(admin: Admin) {
  // The first sync only records "start from here". Doing it before the first
  // email goes out means no reply to that email can be missed.
  if (!recruitImapConfigured()) return
  const { data } = await (admin.from("email_sync_state") as any).select("id").eq("id", RECRUIT_SYNC_KEY).maybeSingle()
  if (!data) await syncRecruitInbox().catch(() => {})
}

/** Try to send one queued email. */
export async function processOne(admin: Admin = createAdminClient()): Promise<"sent" | "failed" | "none"> {
  await ensureSyncBaseline(admin)
  const pace = sendPace()
  const interval = Math.round(pace.minSeconds + Math.random() * (pace.maxSeconds - pace.minSeconds))
  const { data: claimed, error } = await (admin as any).rpc("recruit_claim_send", {
    p_interval_seconds: interval,
    p_max_per_hour: pace.maxPerHour,
  })
  if (error) throw new Error(error.message)
  const row = ((claimed ?? []) as any[])[0] as
    | { id: string; recruit_id: string; subject: string; body: string }
    | undefined
  if (!row) return "none"

  const { data: recruit } = await (admin.from("recruits") as any)
    .select("id, email, stage")
    .eq("id", row.recruit_id)
    .maybeSingle()
  if (!recruit) {
    await (admin.from("recruit_send_queue") as any).update({ status: "failed", error: "Recruit was deleted" }).eq("id", row.id)
    return "failed"
  }

  const messageId = newMessageId()
  try {
    await sendRecruitEmail({ to: recruit.email, subject: row.subject, text: row.body, html: textToHtml(row.body), messageId })
  } catch (err) {
    await (admin.from("recruit_send_queue") as any)
      .update({ status: "failed", error: (err instanceof Error ? err.message : String(err)).slice(0, 500) })
      .eq("id", row.id)
    return "failed"
  }

  const now = new Date()
  await (admin.from("recruit_send_queue") as any).update({ status: "sent", sent_at: now.toISOString(), error: null }).eq("id", row.id)
  await (admin.from("recruit_messages") as any).insert({
    recruit_id: recruit.id,
    direction: "outbound",
    subject: row.subject,
    body_text: row.body,
    body_html: textToHtml(row.body),
    message_id: messageId,
    sent_at: now.toISOString(),
  })
  const early = recruit.stage === "new" || recruit.stage === "emailed"
  await (admin.from("recruits") as any)
    .update({
      last_emailed_at: now.toISOString(),
      ...(early
        ? { stage: "emailed", follow_up_due_at: new Date(now.getTime() + FOLLOW_UP_DAYS * 86400_000).toISOString() }
        : {}),
    })
    .eq("id", recruit.id)
  return "sent"
}

export async function queueCounts(admin: Admin = createAdminClient()): Promise<number> {
  const { count } = await (admin.from("recruit_send_queue") as any).select("id", { count: "exact", head: true }).eq("status", "queued")
  return count ?? 0
}

/** Keep sending (respecting the pace) until the budget runs out or the queue is empty. */
export async function runQueue(budgetMs: number): Promise<TickResult> {
  const admin = createAdminClient()
  const deadline = Date.now() + budgetMs
  const res: TickResult = { sent: 0, failed: 0, queued: 0, waiting: false }
  while (Date.now() < deadline) {
    const r = await processOne(admin)
    if (r === "sent") res.sent++
    else if (r === "failed") res.failed++
    else {
      if ((await queueCounts(admin)) === 0) break
      if (deadline - Date.now() < 4000) break
      await new Promise((ok) => setTimeout(ok, 3000))
    }
  }
  res.queued = await queueCounts(admin)
  res.waiting = res.queued > 0
  return res
}
