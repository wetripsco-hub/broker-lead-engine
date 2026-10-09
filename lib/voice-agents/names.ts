// What the voice agent may say as a person's name. An agent record whose name is
// an email address ("someone@gmail.com") would be read out loud, so anything
// containing "@" (or empty) becomes a neutral phrase instead.
export const NEUTRAL_REP_NAME = "our Load Linkers team"

export function spokenRepName(name: string | null | undefined): string {
  const n = (name ?? "").trim()
  if (!n || n.includes("@")) return NEUTRAL_REP_NAME
  return n
}

// ── The contact, by first name ─────────────────────────────────────────────
// A lead's contact field sometimes holds several people ("John Smith / Mary Jones",
// "A One, B Two"), a "Last, First" form, ALL CAPS, middle names or a generational
// suffix. The voice agent greets ONE person by FIRST name ("Hi John"), which is
// how a phone call sounds and avoids reading middle names or compound surnames.

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "md", "esq", "phd", "cpa", "dds"])
const TITLES = new Set(["mr", "mrs", "ms", "miss", "dr", "prof"])
const SEPARATORS = /\s*(?:[;|/\n\r]|\s&\s|&|\s\+\s|\sand\s|\s-\s)\s*/i

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean)
const bare = (w: string) => w.toLowerCase().replace(/[.,]+$/, "")

/** "JOHN" / "john" -> "John", "MARY-ANN" -> "Mary-Ann", "O'BRIEN" -> "O'Brien"; mixed case ("McDonald", "TaJae") is left alone. */
function tidyCase(w: string): string {
  const shouting = w === w.toUpperCase() && w !== w.toLowerCase()
  const lower = w === w.toLowerCase() && w !== w.toUpperCase()
  if (!shouting && !lower) return w
  return w.toLowerCase().replace(/(^|['-])([a-z])/g, (_, a, b) => a + b.toUpperCase())
}

/**
 * "John Smith / Mary Jones" -> "John". "SMITH, JOHN" -> "John". "Dr. J. Edgar Hoover" -> "Edgar".
 * Nothing usable -> "there" (so the greeting reads "Hi there").
 */
export function spokenContactName(raw: string | null | undefined): string {
  const text = (raw ?? "").trim()
  if (!text) return "there"

  // Several people joined by a separator (a new line counts): the first one only.
  // Spaces are tidied only after splitting, or a line break would be lost.
  let person = text.split(SEPARATORS).map((x) => x.replace(/\s+/g, " ").trim()).find(Boolean) ?? ""

  // Commas: "Last, First", "First Last, Jr.", or "First Last, First Last".
  if (person.includes(",")) {
    const parts = person.split(",").map((x) => x.trim()).filter(Boolean)
    if (parts.length >= 2) {
      const [a, b] = parts
      if (SUFFIXES.has(bare(b))) person = a
      else if (words(a).length >= 2) person = a // two full names separated by a comma
      else person = `${b} ${a}` // "Smith, John" -> "John Smith"
    } else {
      person = parts[0] ?? ""
    }
  }

  const toks = words(person)
  while (toks.length > 1 && SUFFIXES.has(bare(toks[toks.length - 1]))) toks.pop() // "... IV"
  while (toks.length > 1 && TITLES.has(bare(toks[0]))) toks.shift() // "Dr. ..."
  while (toks.length > 1 && /^[A-Za-z]\.?$/.test(toks[0])) toks.shift() // a leading initial: "J. Edgar"
  const given = toks[0] ?? ""
  return given ? tidyCase(given) : "there"
}
