// Recruiter templates: {{first_name}} and {{name}} placeholders.

export const SAMPLE_NAME = "Sarah Johnson"

export function firstNameOf(name: string | null | undefined): string {
  const n = (name ?? "").trim()
  if (!n) return "there"
  return n.split(/\s+/)[0]
}

export function renderTemplate(text: string, recruit: { name: string | null | undefined }): string {
  const full = (recruit.name ?? "").trim()
  return text
    .replace(/\{\{\s*first_name\s*\}\}/gi, firstNameOf(full))
    .replace(/\{\{\s*name\s*\}\}/gi, full || "there")
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

/** Plain-text body -> simple HTML (paragraphs, line breaks, clickable links). */
export function textToHtml(text: string): string {
  const linked = escapeHtml(text).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}">${u}</a>`)
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111">${linked
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px">${p.replace(/\n/g, "<br>")}</p>`)
    .join("")}</div>`
}
