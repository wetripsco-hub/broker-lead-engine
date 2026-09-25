// 1x1 transparent GIF, served by /api/track/open.
export const TRACKING_PIXEL_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
  "base64",
)

function baseUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3001").replace(/\/$/, "")
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

const URL_REGEX = /(https?:\/\/[^\s<>"]+)/g

// Templates are plain text with {{merge_tags}}, not HTML — this turns the
// interpolated text into a trackable HTML email: raw links become anchors
// routed through the click-tracking redirect, and a 1x1 pixel is appended
// so /api/track/open can record when the email is opened.
export function buildTrackedEmailHtml(text: string, eventId: string): string {
  const site = baseUrl()
  const escaped = escapeHtml(text)
  const linked = escaped.replace(URL_REGEX, (url) => {
    const tracked = `${site}/api/track/click?id=${encodeURIComponent(eventId)}&url=${encodeURIComponent(url)}`
    return `<a href="${tracked}">${url}</a>`
  })
  const withBreaks = linked.replace(/\n/g, "<br>")
  const pixel = `<img src="${site}/api/track/open?id=${encodeURIComponent(eventId)}" width="1" height="1" alt="" style="display:none" />`
  return `<div style="font-family:sans-serif;font-size:14px;white-space:normal;">${withBreaks}</div>${pixel}`
}
