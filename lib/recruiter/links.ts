// Find video links in a candidate's reply and classify them. Links are only
// read from the email text; the linked file itself is never fetched.

export type Provider =
  | "attachment" | "gdrive" | "dropbox" | "onedrive" | "wetransfer" | "icloud"
  | "youtube" | "loom" | "vimeo" | "direct" | "unknown"

export interface ClassifiedLink {
  provider: Provider
  original_url: string
  embed_url: string | null
  status: "embedded" | "link"
}

const URL_RE = /https?:\/\/[^\s<>"'`)\]}]+/gi
const HREF_RE = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/gi, "&")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&quot;/gi, '"')
}

function trimTrailing(u: string): string {
  return u.replace(/[.,;:!?'"]+$/, "")
}

/** Outlook SafeLinks (?url=) and Google (/url?q=) redirect wrappers, nested too. */
export function unwrapUrl(raw: string): string {
  let url = raw
  for (let i = 0; i < 5; i++) {
    let u: URL
    try {
      u = new URL(url)
    } catch {
      return url
    }
    const host = u.hostname.toLowerCase()
    let inner: string | null = null
    if (host.endsWith("safelinks.protection.outlook.com")) inner = u.searchParams.get("url")
    else if (/(^|\.)google\.[a-z.]+$/.test(host) && u.pathname === "/url") inner = u.searchParams.get("q") ?? u.searchParams.get("url")
    if (!inner || !/^https?:\/\//i.test(inner)) return url
    url = inner
  }
  return url
}

/** All http(s) URLs from text and HTML (hrefs + visible text), unwrapped and de-duplicated. */
export function extractUrls(text: string | null | undefined, html: string | null | undefined): string[] {
  const found: string[] = []
  if (html) {
    for (const m of html.matchAll(HREF_RE)) {
      const v = decodeEntities((m[1] ?? m[2] ?? m[3] ?? "").trim())
      if (/^https?:\/\//i.test(v)) found.push(v)
    }
    const visible = decodeEntities(html.replace(/<[^>]+>/g, " "))
    for (const m of visible.matchAll(URL_RE)) found.push(m[0])
  }
  if (text) for (const m of text.matchAll(URL_RE)) found.push(m[0])

  const seen = new Set<string>()
  const out: string[] = []
  for (const f of found) {
    const u = trimTrailing(unwrapUrl(trimTrailing(f)))
    let key: string
    try {
      const p = new URL(u)
      p.hash = ""
      key = p.toString().replace(/\/$/, "")
    } catch {
      continue
    }
    if (seen.has(key)) continue
    seen.add(key)
    out.push(u)
  }
  return out
}

const ID_RE = /^[A-Za-z0-9_-]+$/

export function classifyLink(url: string): ClassifiedLink {
  const link = (provider: Provider, embed: string | null = null): ClassifiedLink => ({
    provider,
    original_url: url,
    embed_url: embed,
    status: embed ? "embedded" : "link",
  })
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return link("unknown")
  }
  const host = u.hostname.toLowerCase().replace(/^www\.|^m\./, "")
  const parts = u.pathname.split("/").filter(Boolean)

  // YouTube
  if (host === "youtu.be" && parts[0] && ID_RE.test(parts[0])) return link("youtube", `https://www.youtube.com/embed/${parts[0]}`)
  if (host === "youtube.com" || host === "youtube-nocookie.com" || host === "music.youtube.com") {
    const v = u.searchParams.get("v")
    if (parts[0] === "watch" && v && ID_RE.test(v)) return link("youtube", `https://www.youtube.com/embed/${v}`)
    if (["shorts", "embed", "live", "v"].includes(parts[0]) && parts[1] && ID_RE.test(parts[1])) {
      return link("youtube", `https://www.youtube.com/embed/${parts[1]}`)
    }
    return link("youtube")
  }
  // Loom
  if (host === "loom.com" || host.endsWith(".loom.com")) {
    if (["share", "embed"].includes(parts[0]) && parts[1] && ID_RE.test(parts[1])) return link("loom", `https://www.loom.com/embed/${parts[1]}`)
    return link("loom")
  }
  // Vimeo
  if (host === "player.vimeo.com" && parts[0] === "video" && /^\d+$/.test(parts[1] ?? "")) {
    const h = u.searchParams.get("h")
    return link("vimeo", `https://player.vimeo.com/video/${parts[1]}${h && ID_RE.test(h) ? `?h=${h}` : ""}`)
  }
  if (host === "vimeo.com") {
    const idx = parts.findIndex((p) => /^\d+$/.test(p))
    if (idx >= 0) {
      const hash = parts[idx + 1] && /^[0-9a-f]+$/i.test(parts[idx + 1]) ? `?h=${parts[idx + 1]}` : ""
      return link("vimeo", `https://player.vimeo.com/video/${parts[idx]}${hash}`)
    }
    return link("vimeo")
  }
  if (host === "drive.google.com" || (host === "docs.google.com" && parts[0] === "file")) return link("gdrive")
  if (host === "dropbox.com" || host.endsWith(".dropbox.com") || host === "dl.dropboxusercontent.com" || host === "db.tt") return link("dropbox")
  if (host === "onedrive.live.com" || host === "1drv.ms" || host.endsWith(".sharepoint.com") || host === "onedrive.com") return link("onedrive")
  if (host === "wetransfer.com" || host.endsWith(".wetransfer.com") || host === "we.tl") return link("wetransfer")
  if (host === "icloud.com" || host.endsWith(".icloud.com")) return link("icloud")
  if (/\.(mp4|mov|m4v|webm|avi|mkv|3gp)$/i.test(u.pathname)) return link("direct")
  return link("unknown")
}

/** Links that are never candidate media: our own domains and the links in emails we sent them. */
export function isIgnorableLink(url: string, ownDomains: string[], sentLinks: Set<string>): boolean {
  if (sentLinks.has(url)) return true
  try {
    const host = new URL(url).hostname.toLowerCase()
    return ownDomains.some((d) => host === d || host.endsWith(`.${d}`))
  } catch {
    return true
  }
}

/** Whether a provider means "probably a video" (unknown links are shown but don't move the stage). */
export function isVideoProvider(p: Provider): boolean {
  return p !== "unknown"
}
