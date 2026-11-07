// Recruiter tab checks.   npx tsx scripts/_recruiter-tests.ts
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { parseRecruitCsv } from "../lib/recruiter/csv"
import { classifyLink, extractUrls, isIgnorableLink, unwrapUrl } from "../lib/recruiter/links"
import { classifyAttachment, splitQuoted, summariseStructure } from "../lib/recruiter/mime"
import { parseRange, sliceStream, MAX_RANGE_CHUNK } from "../lib/recruiter/range"
import { renderTemplate } from "../lib/recruiter/template"
import { headerValue, stageAfterReply } from "../lib/recruiter/sync"
import { apiRuleFor, RULES } from "../lib/rate-limit"

let failed = 0
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  ${extra}`}`)
  if (!ok) failed++
}
const read = (f: string) => readFileSync(f, "utf8")
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(n)) out.push(p)
  }
  return out
}

async function main() {
  // ── CSV ──────────────────────────────────────────────────────────────────
  const csv = [
    "Name,EMAIL",
    "Sarah Johnson,Sarah@Example.com",
    "Bad Row,not-an-email",
    "Dup,sarah@example.com",
    "Old,old@example.com",
    "No Name, x@y.co ",
    ",",
  ].join("\n")
  const p = parseRecruitCsv(csv, new Set(["old@example.com"]))
  check("csv: case-insensitive headers, lowercased valid rows", p.valid.map((r) => r.email).join() === "sarah@example.com,x@y.co")
  check("csv: invalid emails reported", p.invalid.length === 2 && p.invalid.some((r) => r.reason === "Not a valid email"))
  check("csv: duplicate inside file reported", p.duplicateInFile.length === 1 && p.duplicateInFile[0].line === 4)
  check("csv: already in recruits reported", p.alreadyExists.length === 1 && p.alreadyExists[0].email === "old@example.com")
  check("csv: missing email column is an error", !!parseRecruitCsv("name,phone\na,1", new Set()).error)
  check("csv: first/last name columns joined", parseRecruitCsv("First Name,Last Name,E-mail\nAli,Khan,a@k.io", new Set()).valid[0]?.name === "Ali Khan")

  // ── Template ─────────────────────────────────────────────────────────────
  check("template: {{first_name}} and {{name}}", renderTemplate("Hi {{first_name}} / {{ name }}", { name: "Sarah Johnson" }) === "Hi Sarah / Sarah Johnson")
  check("template: empty name -> there", renderTemplate("Hi {{first_name}}", { name: "" }) === "Hi there")

  // ── Links ────────────────────────────────────────────────────────────────
  const safe = "https://nam12.safelinks.protection.outlook.com/?url=https%3A%2F%2Fwww.loom.com%2Fshare%2Fabc123def&data=05"
  check("links: SafeLinks unwrapped", unwrapUrl(safe) === "https://www.loom.com/share/abc123def")
  check("links: google.com/url?q= unwrapped", unwrapUrl("https://www.google.com/url?q=https://youtu.be/dQw4w9WgXcQ&sa=D") === "https://youtu.be/dQw4w9WgXcQ")
  const yt = classifyLink("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10")
  check("links: YouTube watch -> embed", yt.status === "embedded" && yt.embed_url === "https://www.youtube.com/embed/dQw4w9WgXcQ")
  check("links: youtu.be + shorts -> embed", classifyLink("https://youtu.be/abcDEF12345").embed_url === "https://www.youtube.com/embed/abcDEF12345" && classifyLink("https://youtube.com/shorts/XyZ_123").embed_url === "https://www.youtube.com/embed/XyZ_123")
  check("links: Loom share -> embed", classifyLink("https://www.loom.com/share/abc123def").embed_url === "https://www.loom.com/embed/abc123def")
  check("links: Vimeo -> player", classifyLink("https://vimeo.com/76979871").embed_url === "https://player.vimeo.com/video/76979871" && classifyLink("https://vimeo.com/76979871/a1b2c3").embed_url === "https://player.vimeo.com/video/76979871?h=a1b2c3")
  for (const [u, prov] of [
    ["https://drive.google.com/file/d/1AbC/view?usp=sharing", "gdrive"],
    ["https://www.dropbox.com/s/xyz/video.mov?dl=0", "dropbox"],
    ["https://we.tl/t-AbCdEf", "wetransfer"],
    ["https://wetransfer.com/downloads/abc", "wetransfer"],
    ["https://1drv.ms/v/s!abc", "onedrive"],
    ["https://www.icloud.com/iclouddrive/0abc#video", "icloud"],
    ["https://cdn.example.com/me.mp4", "direct"],
    ["https://linkedin.com/in/someone", "unknown"],
  ] as const) {
    const c = classifyLink(u)
    check(`links: ${prov} -> link (open only, never fetched)`, c.provider === prov && c.status === "link" && c.embed_url === null && c.original_url === u, JSON.stringify(c))
  }
  const html = `<p>My video: <a href="${safe.replace(/&/g, "&amp;")}">here</a></p><p>https://we.tl/t-AbCdEf.</p>`
  const urls = extractUrls("Also https://we.tl/t-AbCdEf and https://www.loom.com/share/abc123def", html)
  check("links: hrefs + text, unwrapped, de-duplicated", urls.length === 2 && urls.includes("https://www.loom.com/share/abc123def") && urls.includes("https://we.tl/t-AbCdEf"), JSON.stringify(urls))
  check("links: our own domain ignored", isIgnorableLink("https://sell.loadlinkers.co/x", ["loadlinkers.co"], new Set()))
  check("links: links we sent (quoted back) ignored", isIgnorableLink("https://a.com/job", [], new Set(["https://a.com/job"])))

  // ── MIME structure (metadata only) ───────────────────────────────────────
  const struct = {
    type: "multipart/mixed",
    childNodes: [
      { part: "1", type: "multipart/alternative", childNodes: [
        { part: "1.1", type: "text/plain", size: 100 },
        { part: "1.2", type: "text/html", size: 300 },
      ] },
      { part: "2", type: "video/mp4", encoding: "base64", size: 4000, disposition: "attachment", dispositionParameters: { filename: "intro.mp4" } },
      { part: "3", type: "application/octet-stream", disposition: "attachment", dispositionParameters: { filename: "setup.exe" } },
      { part: "4", type: "image/png", id: "<logo@sig>", disposition: "inline", dispositionParameters: { filename: "logo.png" } },
      { part: "5", type: "application/octet-stream", disposition: "attachment", dispositionParameters: { filename: "IMG_0001.MOV" } },
      { part: "6", type: "application/zip", disposition: "attachment", dispositionParameters: { filename: "files.zip" } },
    ],
  }
  const s = summariseStructure(struct)
  check("mime: text + html body parts found", s.textPart?.part === "1.1" && s.htmlPart?.part === "1.2")
  const mp4 = s.attachments.find((a) => a.part === "2")
  check("mime: .mp4 available with name/type/size/part", mp4?.status === "available" && mp4.mime_type === "video/mp4" && mp4.size_bytes === 3000 && mp4.file_name === "intro.mp4")
  check("mime: .exe skipped", s.attachments.find((a) => a.part === "3")?.status === "skipped")
  check("mime: .zip skipped", s.attachments.find((a) => a.part === "6")?.status === "skipped")
  check("mime: inline signature logo ignored", !s.attachments.some((a) => a.part === "4"))
  check("mime: octet-stream .MOV typed as video/quicktime", s.attachments.find((a) => a.part === "5")?.mime_type === "video/quicktime")
  check("mime: .html/.js/.bat/.svg skipped, .pdf/.jpg available", ["a.html", "b.js", "c.bat", "d.svg"].every((n) => classifyAttachment(n, "") === "skipped") && classifyAttachment("cv.pdf", "application/pdf") === "available" && classifyAttachment("me.jpg", "image/jpeg") === "available")
  check("mime: single-part message body is part 1", summariseStructure({ type: "text/plain" }).textPart?.part === "1")

  // ── Range streaming ──────────────────────────────────────────────────────
  check("range: bytes=0- capped chunk", JSON.stringify(parseRange("bytes=0-", 100 * 1024 * 1024)) === JSON.stringify({ start: 0, end: MAX_RANGE_CHUNK - 1 }))
  check("range: explicit + suffix", JSON.stringify(parseRange("bytes=10-19", 100)) === '{"start":10,"end":19}' && JSON.stringify(parseRange("bytes=-10", 100)) === '{"start":90,"end":99}')
  check("range: past end -> 416", parseRange("bytes=200-", 100) === "unsatisfiable")
  async function* src() {
    yield Buffer.from("0123")
    yield Buffer.from("4567")
    yield Buffer.from("89")
  }
  let got = ""
  for await (const c of sliceStream(src(), 3, 8)) got += Buffer.from(c).toString()
  check("range: slice across chunks", got === "345678", got)

  // ── Stage rules ──────────────────────────────────────────────────────────
  check("stage: reply -> replied", stageAfterReply("emailed", false) === "replied")
  check("stage: reply with media -> video_received", stageAfterReply("replied", true) === "video_received")
  check("stage: later stages never moved back", stageAfterReply("interview", true) === "interview" && stageAfterReply("hired", false) === "hired" && stageAfterReply("video_received", false) === "video_received")
  check("headers: folded References read", headerValue("References: <a@x>\r\n <b@x>\r\nIn-Reply-To: <b@x>\r\n", "references") === "<a@x> <b@x>")
  check("quote: reply split from quoted original", splitQuoted("Here is my video\n\nOn Mon, Nov 3, 2026 at 9:00 AM Loadlinkers wrote:\n> Hi").fresh === "Here is my video")

  // ── Wiring / isolation ───────────────────────────────────────────────────
  const mig = read("supabase/migrations/20261108000001_recruiter.sql")
  for (const t of ["recruits", "recruit_templates", "recruit_messages", "recruit_media", "recruit_send_queue"]) {
    check(`migration: ${t} created`, new RegExp(`create table if not exists public\\.${t} `).test(mig))
  }
  check("migration: RLS admin-only on every table", /enable row level security/.test(mig) && /using \(public\.is_admin\(\)\) with check \(public\.is_admin\(\)\)/.test(mig) && /revoke all on public\.%I from anon/.test(mig))
  check("migration: claim function service-role only", /revoke execute on function public\.recruit_claim_send[^;]*from public, anon, authenticated/.test(mig))
  check("migration: no storage bucket, no file bytes column", !/storage\./i.test(mig) && !/bytea/i.test(mig))
  const recruiterCode = [...walk("lib/recruiter"), ...walk("app/(dashboard)/recruiter"), ...walk("app/api/recruiter")]
  check("no Supabase Storage use in recruiter code", recruiterCode.every((f) => !/\.storage\b|recruit-attachments/.test(read(f))))
  check("no disk writes in recruiter code", recruiterCode.every((f) => !/writeFile|createWriteStream|fs\/promises/.test(read(f))))
  check("recruiter env vars never NEXT_PUBLIC", recruiterCode.every((f) => !/NEXT_PUBLIC_RECRUIT/.test(read(f))))
  check("page redirects non-admins", /app_metadata\?\.role !== "admin"\) redirect/.test(read("app/(dashboard)/recruiter/page.tsx")))
  const actions = read("app/(dashboard)/recruiter/actions.ts")
  const exported = actions.match(/export async function \w+/g) ?? []
  const guarded = actions.split("export async function ").slice(1).filter((b) => /recruiterAdmin\(\)/.test(b.split("\n").slice(0, 7).join("\n")))
  check("every server action checks admin first", exported.length > 0 && guarded.length === exported.length, `${guarded.length}/${exported.length}`)
  const route = read("app/api/recruiter/attachment/[mediaId]/route.ts")
  check("attachment route: admin check, no-store, Range, download, gone message", /recruiterAdmin\(\)/.test(route) && /private, no-store/.test(route) && /Content-Range/.test(route) && /download"\) === "1"/.test(route) && /Attachment no longer in mailbox/.test(route) && /status !== "available"/.test(route))
  check("cron route: CRON_SECRET or admin", /CRON_SECRET/.test(read("app/api/recruiter/cron/route.ts")) && /recruiterAdmin\(\)/.test(read("app/api/recruiter/cron/route.ts")))
  const sync = read("lib/recruiter/sync.ts")
  check("sync: read-only mailbox, separate sync key", /readOnly: true/.test(sync) && /RECRUIT_SYNC_KEY/.test(sync) && !/messageDelete|messageMove|messageFlagsAdd/.test(sync))
  check("sync: attachment bytes never downloaded", !/source: true/.test(sync) && (sync.match(/client\.download\(/g) ?? []).length === 1 && /summary\.textPart|summary\.htmlPart/.test(sync))
  const sidebar = read("components/layout/app-sidebar.tsx")
  check("sidebar: Recruiter only inside the admin block", sidebar.indexOf('href="/recruiter"') > sidebar.indexOf("{isAdmin && ("))
  check("CSP allows the video players", ["https://www.youtube.com", "https://www.loom.com", "https://player.vimeo.com"].every((s) => read("next.config.ts").includes(s)))
  check("rate: recruiter cron + media rules", apiRuleFor("/api/recruiter/cron") === RULES.cron && apiRuleFor("/api/recruiter/attachment/x") === RULES.media)

  console.log(failed ? `\n${failed} FAILED` : "\nAll recruiter tests passed")
  process.exit(failed ? 1 : 0)
}
main()
