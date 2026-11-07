// HTTP Range helpers for streaming attachments straight from the mailbox.

/** Largest slice served for an open-ended range ("bytes=N-"); the browser asks again for more. */
export const MAX_RANGE_CHUNK = 8 * 1024 * 1024

/** Parse "bytes=start-end" against a known size. null = no/invalid range (serve whole file). */
export function parseRange(header: string | null, size: number): { start: number; end: number } | "unsatisfiable" | null {
  if (!header) return null
  const m = header.trim().match(/^bytes=(\d*)-(\d*)$/)
  if (!m || (m[1] === "" && m[2] === "")) return null
  let start: number
  let end: number
  if (m[1] === "") {
    const n = Number(m[2])
    if (n === 0) return "unsatisfiable"
    start = Math.max(0, size - n)
    end = size - 1
  } else {
    start = Number(m[1])
    end = m[2] === "" ? Math.min(size - 1, start + MAX_RANGE_CHUNK - 1) : Math.min(Number(m[2]), size - 1)
  }
  if (start >= size || start > end) return "unsatisfiable"
  return { start, end }
}

/** Pass through only bytes [start, end] of a stream of chunks. */
export async function* sliceStream(src: AsyncIterable<Buffer | Uint8Array>, start: number, end: number): AsyncGenerator<Uint8Array> {
  let pos = 0
  for await (const raw of src) {
    const chunk = raw instanceof Uint8Array ? raw : Buffer.from(raw)
    const chunkEnd = pos + chunk.length - 1
    if (chunkEnd >= start) {
      const from = Math.max(0, start - pos)
      const to = Math.min(chunk.length, end - pos + 1)
      if (to > from) yield chunk.subarray(from, to)
    }
    pos += chunk.length
    if (pos > end) return
  }
}

/** Content-Disposition with a safe ASCII fallback and the UTF-8 name. */
export function contentDisposition(kind: "inline" | "attachment", fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") || "file"
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}
