import { Fragment, type ReactNode } from "react"

// A small, safe markdown renderer for the Company page: headings (#, ##, ###),
// "---" rules, bullet and numbered lists (indented lines continue an item),
// paragraphs and **bold** / `code`. Builds React elements, never raw HTML, so
// nothing typed into the editor can inject markup.
//
// Inside a paragraph a line that starts with ** begins a new line, so a run
// of bold-led lines (like the "Common questions") stays one per line.

type Block =
  | { kind: "h"; level: 1 | 2 | 3; text: string }
  | { kind: "hr" }
  | { kind: "ul" | "ol"; items: string[] }
  | { kind: "p"; lines: string[] }

function parse(md: string): Block[] {
  const blocks: Block[] = []
  let para: string[] | null = null
  let list: { kind: "ul" | "ol"; items: string[] } | null = null
  const flush = () => {
    if (para) blocks.push({ kind: "p", lines: para })
    if (list) blocks.push(list)
    para = null
    list = null
  }

  for (const raw of md.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd()
    if (!line.trim()) {
      flush()
      continue
    }
    const h = line.match(/^(#{1,3})\s+(.*)$/)
    if (h) {
      flush()
      blocks.push({ kind: "h", level: h[1].length as 1 | 2 | 3, text: h[2] })
      continue
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      flush()
      blocks.push({ kind: "hr" })
      continue
    }
    const ul = line.match(/^\s*[-*]\s+(.*)$/)
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/)
    if (ul || ol) {
      const kind = ul ? "ul" : "ol"
      if (para) {
        blocks.push({ kind: "p", lines: para })
        para = null
      }
      if (!list || list.kind !== kind) {
        if (list) blocks.push(list)
        list = { kind, items: [] }
      }
      list.items.push((ul ?? ol)![1])
      continue
    }
    // An indented line right after a list item continues that item.
    if (list && /^\s+/.test(raw)) {
      list.items[list.items.length - 1] += " " + line.trim()
      continue
    }
    if (list) {
      blocks.push(list)
      list = null
    }
    ;(para ??= []).push(line.trim())
  }
  flush()
  return blocks
}

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /\*\*(.+?)\*\*|`([^`]+)`/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(
      m[1] !== undefined ? (
        <strong key={m.index} className="font-semibold text-foreground">{m[1]}</strong>
      ) : (
        <code key={m.index} className="rounded bg-muted px-1 py-0.5 text-[0.9em]">{m[2]}</code>
      ),
    )
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function paragraph(lines: string[]): ReactNode[] {
  const out: ReactNode[] = []
  lines.forEach((l, i) => {
    if (i > 0) out.push(l.startsWith("**") ? <br key={`br${i}`} /> : " ")
    out.push(<Fragment key={i}>{inline(l)}</Fragment>)
  })
  return out
}

export function MarkdownView({ source }: { source: string }) {
  return (
    <div className="space-y-3 text-sm leading-relaxed text-foreground/90">
      {parse(source).map((b, i) => {
        switch (b.kind) {
          case "h":
            if (b.level === 1) return <h1 key={i} className="text-2xl font-semibold tracking-tight text-foreground">{inline(b.text)}</h1>
            if (b.level === 2) return <h2 key={i} className="pt-2 text-lg font-semibold tracking-tight text-foreground">{inline(b.text)}</h2>
            return <h3 key={i} className="pt-1 text-base font-semibold text-foreground">{inline(b.text)}</h3>
          case "hr":
            return <hr key={i} className="my-5 border-border" />
          case "ul":
            return (
              <ul key={i} className="list-disc space-y-1 pl-5">
                {b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}
              </ul>
            )
          case "ol":
            return (
              <ol key={i} className="list-decimal space-y-1 pl-5">
                {b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}
              </ol>
            )
          case "p":
            return <p key={i}>{paragraph(b.lines)}</p>
        }
      })}
    </div>
  )
}
