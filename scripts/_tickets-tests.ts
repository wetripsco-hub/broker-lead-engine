// Offline checks for lib/tickets.ts.   npx tsx scripts/_tickets-tests.ts
import { validateNewTicket, validateReply, statusAfterReply, SUBJECT_MAX, BODY_MAX } from "../lib/tickets"

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

console.log(failed ? `\n${failed} FAILED` : "\nall passed")
if (failed) process.exit(1)
