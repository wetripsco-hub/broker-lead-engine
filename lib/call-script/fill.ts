// Fills the [Placeholders] of the call script. Anything we do not know stays as the
// placeholder (and is flagged missing) so the panel can highlight it. Never blank.

export interface ScriptVars {
  /** Lead's contact first name; null when the lead has no usable contact name. */
  name: string | null
  /** Logged-in user's first name / full name; null when the name is missing or looks like an email. */
  firstName: string | null
  fullName: string | null
  /** The agent's callback number (admin sets it in Settings), as it should be spoken/written. */
  phone: string | null
  /** Typed into the script panel during the call. */
  day: string
  time: string
}

export interface Segment {
  text: string
  /** Set when this piece is a placeholder we could not fill. */
  missing?: string
}

const TOKEN = /\[(Name|First Name|Full Name|day|time|number|Phone)\]/g

function valueFor(token: string, v: ScriptVars): string | null {
  const clean = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null)
  switch (token) {
    case "Name": return clean(v.name)
    case "First Name": return clean(v.firstName)
    case "Full Name": return clean(v.fullName)
    case "day": return clean(v.day)
    case "time": return clean(v.time)
    case "number":
    case "Phone": return clean(v.phone)
    default: return null
  }
}

/** Splits text into plain pieces and placeholders (filled, or marked missing). */
export function fillSegments(text: string, v: ScriptVars): Segment[] {
  const out: Segment[] = []
  let last = 0
  for (const m of text.matchAll(TOKEN)) {
    const at = m.index ?? 0
    if (at > last) out.push({ text: text.slice(last, at) })
    const value = valueFor(m[1], v)
    out.push(value ? { text: value } : { text: m[0], missing: m[1] })
    last = at + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}

/** Plain text with everything we know filled in; unknown placeholders stay as [Placeholder]. */
export function fillText(text: string, v: ScriptVars): string {
  return fillSegments(text, v).map((s) => s.text).join("")
}

/** Names of placeholders still unfilled in this text (for a "fill these in first" warning). */
export function missingPlaceholders(text: string, v: ScriptVars): string[] {
  return [...new Set(fillSegments(text, v).flatMap((s) => (s.missing ? [s.missing] : [])))]
}

/** Agent's first word of their name, or null when the name is empty or an email address. */
export function agentNames(raw: string | null | undefined): { firstName: string | null; fullName: string | null } {
  const n = (raw ?? "").trim()
  if (!n || n.includes("@")) return { firstName: null, fullName: null }
  return { firstName: n.split(/\s+/)[0], fullName: n }
}
