import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { recruiterAdmin } from "@/lib/recruiter/auth"
import { recruitImap } from "@/lib/recruiter/mail"
import { isPreviewable } from "@/lib/recruiter/mime"
import { contentDisposition, parseRange, sliceStream } from "@/lib/recruiter/range"

export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * GET /api/recruiter/attachment/[mediaId]   (admin only)
 *
 * Streams one attachment straight out of the info@ mailbox: only that MIME
 * part is fetched over IMAP and piped to the browser. Nothing is written to
 * disk, the database (apart from the file's size, once) or Storage.
 * ?download=1 -> Content-Disposition: attachment. Range requests supported.
 */
const GONE = "Attachment no longer in mailbox"

function text(status: number, body: string) {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" } })
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ mediaId: string }> }) {
  if (!(await recruiterAdmin())) return text(401, "Unauthorized")
  const { mediaId } = await params
  if (!/^[0-9a-f-]{36}$/i.test(mediaId)) return text(404, "Not found")

  const admin = createAdminClient()
  const { data: media } = await (admin.from("recruit_media") as any)
    .select("id, message_id, source_type, status, file_name, mime_type, imap_uid, imap_mailbox, mime_part_id, decoded_size")
    .eq("id", mediaId)
    .maybeSingle()
  if (!media || media.source_type !== "attachment" || !media.imap_uid || !media.mime_part_id) return text(404, "Not found")
  if (media.status !== "available") return text(403, "Unsafe file type, not opened")

  const { data: parent } = await (admin.from("recruit_messages") as any).select("message_id").eq("id", media.message_id).maybeSingle()

  const download = req.nextUrl.searchParams.get("download") === "1"
  const mime = String(media.mime_type || "application/octet-stream")
  const inline = !download && isPreviewable(mime)
  const contentType = inline ? mime : "application/octet-stream"
  const uid = String(media.imap_uid)
  const part = String(media.mime_part_id)

  const client = recruitImap()
  let lock: { release: () => void } | null = null
  const close = async () => {
    try {
      lock?.release()
    } catch {}
    lock = null
    await client.logout().catch(() => {})
  }

  try {
    await client.connect()
    lock = await client.getMailboxLock(media.imap_mailbox || "INBOX", { readOnly: true })

    // The UID must still point at the same email (UIDs can be reassigned by the server).
    const msg = await client.fetchOne(uid, { envelope: true }, { uid: true })
    const storedId = parent?.message_id as string | undefined
    if (!msg || (storedId && !storedId.startsWith("<imap-") && msg.envelope?.messageId && msg.envelope.messageId !== storedId)) {
      await close()
      return text(410, GONE)
    }

    // Exact size, needed for Range. Counted once by streaming the part, then kept as metadata.
    let size: number | null = media.decoded_size ? Number(media.decoded_size) : null
    if (size == null) {
      const dl = await client.download(uid, part, { uid: true })
      if (!dl?.content) {
        await close()
        return text(410, GONE)
      }
      let n = 0
      for await (const c of dl.content) n += (c as Buffer).length
      size = n
      await (admin.from("recruit_media") as any).update({ decoded_size: n }).eq("id", media.id)
    }

    const range = parseRange(req.headers.get("range"), size)
    if (range === "unsatisfiable") {
      await close()
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}`, "Cache-Control": "private, no-store" } })
    }
    const start = range ? range.start : 0
    const end = range ? range.end : size - 1

    // Reading stops (stream destroyed) as soon as byte `end` has been sent.
    const dl = await client.download(uid, part, { uid: true })
    if (!dl?.content) {
      await close()
      return text(410, GONE)
    }
    const source = dl.content
    const iter = sliceStream(source as AsyncIterable<Buffer>, start, end)
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { value, done } = await iter.next()
          if (done) {
            controller.close()
            source.destroy()
            await close()
          } else controller.enqueue(value)
        } catch (err) {
          controller.error(err)
          source.destroy()
          await close()
        }
      },
      async cancel() {
        source.destroy()
        await close()
      },
    })

    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
      "Content-Disposition": contentDisposition(inline ? "inline" : "attachment", media.file_name || "attachment"),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      // A file from a stranger is never allowed to run script on our origin.
      "Content-Security-Policy": mime === "application/pdf" ? "default-src 'none'; style-src 'unsafe-inline'; img-src data:" : "default-src 'none'; sandbox",
    }
    if (range) headers["Content-Range"] = `bytes ${start}-${end}/${size}`
    return new Response(body, { status: range ? 206 : 200, headers })
  } catch (err) {
    await close()
    const m = err instanceof Error ? err.message : String(err)
    if (/not set up/i.test(m)) return text(503, m)
    return text(502, `Could not read the mailbox: ${m}`)
  }
}
