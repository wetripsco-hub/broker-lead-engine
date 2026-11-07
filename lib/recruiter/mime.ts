// Walk an IMAP BODYSTRUCTURE (no attachment bytes are fetched) to find the
// text/html body parts and the attachments' metadata.

export interface StructNode {
  part?: string
  type: string
  parameters?: Record<string, string>
  id?: string
  encoding?: string
  size?: number
  disposition?: string
  dispositionParameters?: Record<string, string>
  childNodes?: StructNode[]
}

export interface AttachmentInfo {
  part: string
  file_name: string
  mime_type: string
  /** Approximate decoded size (base64 is ~4/3 larger on the wire). */
  size_bytes: number | null
  encoding: string | null
  status: "available" | "skipped"
}

export interface StructureSummary {
  textPart: { part: string; size: number } | null
  htmlPart: { part: string; size: number } | null
  attachments: AttachmentInfo[]
}

const RISKY_EXT = new Set([
  "exe", "bat", "cmd", "com", "scr", "msi", "msp", "pif", "cpl", "dll", "sys", "vbs", "vbe", "js", "jse", "mjs",
  "wsf", "wsh", "ps1", "psm1", "jar", "hta", "html", "htm", "xhtml", "shtml", "svg", "svgz", "xml", "sh", "bash",
  "app", "dmg", "pkg", "apk", "ipa", "deb", "rpm", "iso", "img", "lnk", "reg", "url", "chm", "docm", "xlsm", "pptm",
  "zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz", "zst", "cab", "arj", "lz", "lzh", "ace",
])
const RISKY_MIME = /(x-msdownload|x-msdos|x-executable|x-sh|javascript|ecmascript|html|svg|xml|zip|rar|7z|x-tar|gzip|x-bzip|java-archive|vnd\.android|x-apple-diskimage|x-iso9660|hta|x-ms-shortcut)/i

export function extOf(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]{1,8})$/)
  return m ? m[1] : ""
}

/** Viewable in the browser (video player, image, PDF). Anything else that isn't risky is download-only. */
export function isPreviewable(mime: string): boolean {
  const m = mime.toLowerCase()
  return m.startsWith("video/") || /^image\/(jpeg|jpg|png|gif|webp|heic|heif|avif|bmp)$/.test(m) || m === "application/pdf"
}

export function classifyAttachment(fileName: string, mime: string): "available" | "skipped" {
  const ext = extOf(fileName)
  if (RISKY_EXT.has(ext)) return "skipped"
  // A double extension like "video.mp4.exe" is caught above; "invoice.pdf" typed as html is caught here.
  if (RISKY_MIME.test(mime)) return "skipped"
  return "available"
}

/** Best guess at the real type when the sender's mail app said application/octet-stream. */
export function mimeFromName(fileName: string, mime: string): string {
  const m = mime.toLowerCase()
  if (m && m !== "application/octet-stream") return m
  const map: Record<string, string> = {
    mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm", avi: "video/x-msvideo",
    mkv: "video/x-matroska", "3gp": "video/3gpp", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
    gif: "image/gif", webp: "image/webp", heic: "image/heic", heif: "image/heif", pdf: "application/pdf",
  }
  return map[extOf(fileName)] ?? (m || "application/octet-stream")
}

function decodedSizeEstimate(node: StructNode): number | null {
  if (!node.size) return null
  return (node.encoding ?? "").toLowerCase() === "base64" ? Math.floor((node.size * 3) / 4) : node.size
}

export function summariseStructure(root: StructNode): StructureSummary {
  const out: StructureSummary = { textPart: null, htmlPart: null, attachments: [] }
  const walk = (node: StructNode, isRoot: boolean) => {
    if (node.childNodes && node.childNodes.length) {
      for (const c of node.childNodes) walk(c, false)
      return
    }
    const part = node.part ?? (isRoot ? "1" : "")
    if (!part) return
    const type = (node.type ?? "").toLowerCase()
    const disp = (node.disposition ?? "").toLowerCase()
    const fileName = (node.dispositionParameters?.filename ?? node.parameters?.name ?? "").trim()

    // message/rfc822 (a forwarded email) is treated as one attachment, not walked into.
    const isBody = (type === "text/plain" || type === "text/html") && disp !== "attachment" && !fileName
    if (isBody) {
      if (type === "text/plain" && !out.textPart) out.textPart = { part, size: node.size ?? 0 }
      if (type === "text/html" && !out.htmlPart) out.htmlPart = { part, size: node.size ?? 0 }
      return
    }
    // Inline signature images / logos referenced from the HTML (Content-ID, no attachment disposition).
    if (type.startsWith("image/") && node.id && disp !== "attachment") return
    if (!fileName && disp !== "attachment" && !type.startsWith("video/")) return

    const name = fileName || `attachment-${part}`
    const mime = mimeFromName(name, type)
    out.attachments.push({
      part,
      file_name: name.slice(0, 255),
      mime_type: mime,
      size_bytes: decodedSizeEstimate(node),
      encoding: node.encoding ?? null,
      status: classifyAttachment(name, mime),
    })
  }
  walk(root, true)
  return out
}

/** HTML -> readable text (used only when an email has no text/plain part). Never rendered as HTML. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/** Split a reply into what the candidate wrote and the quoted earlier email. */
export function splitQuoted(text: string): { fresh: string; quoted: string } {
  const lines = text.split(/\r?\n/)
  const idx = lines.findIndex(
    (l, i) =>
      /^\s*On .{4,200}wrote:\s*$/.test(l) ||
      (/^\s*On .{4,200}$/.test(l) && /wrote:\s*$/.test(lines[i + 1] ?? "")) ||
      /^-{2,}\s*Original Message\s*-{2,}/i.test(l) ||
      /^\s*From:\s.+/.test(l) && /^\s*(Sent|Date):\s/.test(lines[i + 1] ?? "") ||
      /^>/.test(l),
  )
  if (idx <= 0) return { fresh: text.trim(), quoted: idx === 0 ? "" : "" }
  return { fresh: lines.slice(0, idx).join("\n").trim(), quoted: lines.slice(idx).join("\n").trim() }
}
