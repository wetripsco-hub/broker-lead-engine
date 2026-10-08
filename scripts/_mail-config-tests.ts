// Offline checks that mail addresses come from the environment only.
//   npx tsx scripts/_mail-config-tests.ts
export {} // module scope
let failed = 0
const check = (n: string, c: boolean) => { console.log(`${c ? "PASS" : "FAIL"}  ${n}`); if (!c) failed++ }

async function main() {
  // From / Reply-To follow the env.
  process.env.EMAIL_PROVIDER = "smtp"
  process.env.SMTP_USER = "mailbox@example.test"
  process.env.SMTP_FROM = "mailbox@example.test"
  process.env.IMAP_USER = "mailbox@example.test"
  delete process.env.EMAIL_REPLY_TO
  const { fromAddress } = await import("../lib/email/send")
  const { replyToAddress, bareAddress } = await import("../lib/email/message-id")
  check("smtp From comes from SMTP_FROM", fromAddress("smtp") === "mailbox@example.test")
  check("Reply-To falls back to IMAP_USER", replyToAddress() === "mailbox@example.test")
  process.env.EMAIL_REPLY_TO = "replies@example.test"
  check("EMAIL_REPLY_TO wins when set", replyToAddress() === "replies@example.test")
  check("bareAddress strips display name", bareAddress("Name <a@b.test>") === "a@b.test")

  // No sender configured -> refuses to send, never falls back to a built-in address.
  delete process.env.EMAIL_FROM
  const resend = await import("../lib/email/resend")
  check("Resend has no built-in default sender", resend.EMAIL_FROM === "")
  const { sendEmail } = await import("../lib/email/send")
  const r = await sendEmail({ to: "x@y.test", subject: "s", text: "t", provider: "resend" })
  check("sendEmail with no EMAIL_FROM returns an error instead of sending", r.id === null && /EMAIL_FROM/.test(r.error ?? ""))

  console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) FAILED.`)
  process.exit(failed === 0 ? 0 : 1)
}
main()
