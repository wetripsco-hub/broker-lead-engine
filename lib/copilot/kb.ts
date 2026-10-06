import type { SupabaseClient } from "@supabase/supabase-js"

// Roughly 4 characters per token. Under the cap the whole manual goes in the
// prompt (stable text -> cacheable); over it, only the best-matching chunks do.
const FULL_PROMPT_TOKEN_LIMIT = 30_000
const CHUNK_CHARS = 1_500
const TOP_CHUNKS = 12

const STOP = new Set(
  "the and for with that this are you your have has not but how what about can does".split(" "),
)

const words = (s: string) => (s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((w) => !STOP.has(w))

interface KbRow {
  title: string
  content: string
  kind: "manual" | "playbook"
}

function chunk(row: KbRow): string[] {
  const out: string[] = []
  let cur = ""
  for (const p of row.content.split(/\n{2,}/)) {
    if (cur && cur.length + p.length > CHUNK_CHARS) {
      out.push(cur)
      cur = ""
    }
    cur += (cur ? "\n\n" : "") + p
  }
  if (cur) out.push(cur)
  return out.map((c) => `[${row.title}]\n${c}`)
}

/**
 * Knowledge text for the system prompt. `query` (recent broker speech) only
 * matters for large knowledge bases, where it drives chunk retrieval. The
 * objection playbook is always included in full — it is short, and missing
 * an approved answer would be worse than a few extra tokens.
 */
export async function loadKnowledge(
  supabase: SupabaseClient<any, any, any>,
  query: string,
): Promise<{ text: string; empty: boolean }> {
  const { data } = await supabase
    .from("knowledge_base")
    .select("title, content, kind")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
  const rows = ((data ?? []) as KbRow[]).filter((r) => r.content.trim())

  const manual = rows.filter((r) => r.kind === "manual")
  const playbook = rows.filter((r) => r.kind === "playbook")

  let manualText: string
  const totalChars = manual.reduce((n, r) => n + r.content.length + r.title.length, 0)
  if (totalChars / 4 <= FULL_PROMPT_TOKEN_LIMIT) {
    manualText = manual.map((r) => `## ${r.title}\n${r.content}`).join("\n\n")
  } else {
    const q = new Set(words(query))
    manualText = manual
      .flatMap(chunk)
      .map((c) => ({ c, score: words(c).filter((w) => q.has(w)).length }))
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_CHUNKS)
      .map((s) => s.c)
      .join("\n\n---\n\n")
  }

  const playbookText = playbook
    .map((r) => `Objection: "${r.title}"\nApproved answer: ${r.content}`)
    .join("\n\n")

  const text = [manualText && `# MANUAL\n${manualText}`, playbookText && `# OBJECTION PLAYBOOK\n${playbookText}`]
    .filter(Boolean)
    .join("\n\n")

  return { text, empty: text.length === 0 }
}
