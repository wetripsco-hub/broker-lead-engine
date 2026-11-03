// Offline checks for lib/support-request.ts.   npx tsx scripts/_support-request-tests.ts
import {
  validateSupportRequest,
  validateNewPassword,
  isRateLimited,
  MESSAGE_MAX,
  SUPPORT_RATE_LIMIT,
} from "../lib/support-request"

let failed = 0
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
  if (!ok) failed++
}

eq("valid request, id normalised", validateSupportRequest({ loginId: "  Ali@Example.com ", message: " help " }), {
  ok: true,
  value: { loginId: "ali@example.com", message: "help" },
})
eq("missing id", validateSupportRequest({ loginId: " ", message: "x" }).ok, false)
eq("missing message", validateSupportRequest({ loginId: "a@b.co", message: "  " }).ok, false)
eq("non-string input", validateSupportRequest({ loginId: 5, message: null }).ok, false)
eq("message at limit ok", validateSupportRequest({ loginId: "a@b.co", message: "x".repeat(MESSAGE_MAX) }).ok, true)
eq("message over limit", validateSupportRequest({ loginId: "a@b.co", message: "x".repeat(MESSAGE_MAX + 1) }).ok, false)

eq("rate limit is 3", SUPPORT_RATE_LIMIT, 3)
eq("2 in last hour -> allowed", isRateLimited(2), false)
eq("3 in last hour -> limited", isRateLimited(3), true)

eq("password ok", validateNewPassword("old-pass", "new-pass", "new-pass"), null)
eq("no current", validateNewPassword("", "new-pass", "new-pass"), "Enter your current password.")
eq("too short", validateNewPassword("old-pass", "abc12", "abc12"), "New password must be at least 6 characters.")
eq("6 chars ok", validateNewPassword("old-pass", "abc123", "abc123"), null)
eq("same as current", validateNewPassword("same12", "same12", "same12"), "New password must be different from the current one.")
eq("mismatch", validateNewPassword("old-pass", "new-pass", "new-pas"), "New passwords do not match.")

console.log(failed ? `\n${failed} FAILED` : "\nall passed")
if (failed) process.exit(1)
