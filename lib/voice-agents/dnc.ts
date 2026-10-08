// Conservative backstop used by every provider: even if the provider's own
// analysis doesn't flag it, an explicit "stop calling me" anywhere in the call
// is treated as a do-not-call request.
const STOP_PHRASES = /\b(stop calling|don'?t call( me)?( again)?|do not call|remove me|take me off)\b/i

export function mentionsStopRequest(...texts: Array<string | null | undefined>): boolean {
  return STOP_PHRASES.test(texts.filter(Boolean).join("\n"))
}
