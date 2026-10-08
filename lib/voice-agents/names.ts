// What the voice agent may say as a person's name. An agent record whose name is
// an email address ("someone@gmail.com") would be read out loud, so anything
// containing "@" (or empty) becomes a neutral phrase instead.
export const NEUTRAL_REP_NAME = "our Load Linkers team"

export function spokenRepName(name: string | null | undefined): string {
  const n = (name ?? "").trim()
  if (!n || n.includes("@")) return NEUTRAL_REP_NAME
  return n
}
