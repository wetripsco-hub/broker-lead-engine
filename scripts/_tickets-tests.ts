// Offline checks for lib/tickets.ts.   npx tsx scripts/_tickets-tests.ts
import { readFileSync } from "node:fs"
import { validateNewTicket, validateReply, statusAfterReply, supportSubject, SUBJECT_MAX, BODY_MAX } from "../lib/tickets"

let failed = 0
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
  if (!ok) failed++
}

const base = { topic: "own", subject: "How do I explain the trial?", body: "Broker asked …", leadId: null }

eq("own question is valid", validateNewTicket(base), {
  ok: true,
  value: { topic: "own", subject: "How do I explain the trial?", body: "Broker asked …", leadId: null },
})
eq("own question drops a lead id", (validateNewTicket({ ...base, leadId: "L1" }) as any).value?.leadId, null)
eq("client ticket needs a lead", validateNewTicket({ ...base, topic: "client" }), { ok: false, error: "Pick the client (lead) this is about." })
eq("client ticket with lead", (validateNewTicket({ ...base, topic: "client", leadId: "L1" }) as any).value?.leadId, "L1")
eq("bad topic", validateNewTicket({ ...base, topic: "x" }).ok, false)
eq("empty subject", validateNewTicket({ ...base, subject: "  " }), { ok: false, error: "Write a short subject." })
eq("empty body", validateNewTicket({ ...base, body: "\n " }), { ok: false, error: "Describe your question." })
eq("subject too long", validateNewTicket({ ...base, subject: "x".repeat(SUBJECT_MAX + 1) }).ok, false)
eq("body too long", validateNewTicket({ ...base, body: "x".repeat(BODY_MAX + 1) }).ok, false)
eq("trims", (validateNewTicket({ ...base, subject: "  Hi  ", body: "  there " }) as any).value, { topic: "own", subject: "Hi", body: "there", leadId: null })

eq("reply ok", validateReply("  Thanks "), { ok: true, body: "Thanks" })
eq("reply empty", validateReply("   ").ok, false)
eq("reply too long", validateReply("x".repeat(BODY_MAX + 1)).ok, false)

eq("admin reply -> answered", statusAfterReply(true), "answered")
eq("agent reply -> back to open", statusAfterReply(false), "open")

// "Ask support" from a lead page / the dialer.
eq("ask support: subject has company + question", supportSubject("Acme Freight", "  Do you   support factoring? "), "Client question (Acme Freight): Do you support factoring?")
eq("ask support: no company", supportSubject(null, "Price?"), "Client question: Price?")
eq("ask support: long question cut to the limit", supportSubject("Acme", "x".repeat(400)).length, SUBJECT_MAX)
eq("ask support: subject passes validation", validateNewTicket({ topic: "client", subject: supportSubject("Acme", "y".repeat(400)), body: "b", leadId: "L1" }).ok, true)
{
  const r = (f: string) => readFileSync(f, "utf8")
  const btn = r("components/leads/ask-support-button.tsx")
  eq("ask support: sends a client ticket via createTicket", /createTicket\(\{ topic: "client"[^}]*leadId/.test(btn), true)
  const lead = r("app/(dashboard)/leads/[id]/page.tsx")
  eq("ask support: on the lead page for agents", /!isAdmin && \([\s\S]{0,40}<AskSupportButton/.test(lead), true)
  eq("ask support: in the agent dialer", /askSupport &&[\s\S]*<AskSupportButton/.test(r("components/leads/dialer-modal.tsx")) && /^\s*askSupport$/m.test(r("components/leads/call-button.tsx")), true)
  const layout = r("app/(dashboard)/layout.tsx")
  eq("header: level + balance chip only for agents", /role !== "admin" && agent && \([\s\S]*<EarningsChip/.test(layout), true)
  const chip = r("components/layout/earnings-chip.tsx")
  eq("header chip: balance, this month, monthly recurring", ["s.pendingCents", "s.thisMonthEarnedCents", "e.monthlyRecurringCents"].every((k) => chip.includes(k)), true)
  eq("header chip reads own rows only (agent_id filter)", (r("components/layout/earnings-chip.tsx").match(/eq\("agent_id", agentId\)/g) ?? []).length, 2)
}

console.log(failed ? `\n${failed} FAILED` : "\nall passed")
if (failed) process.exit(1)
