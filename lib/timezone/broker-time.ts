// Broker-local time + "is it OK to call right now" logic. Pure functions —
// no React, no Date.now() — so it's trivially testable with a fixed instant.
//
// DST is never computed by hand: every offset comes from Intl.DateTimeFormat
// with an IANA zone, so the platform's tz database handles it.

// ── Calling window (broker's local time) ────────────────────────────────────
export const CALL_START_HOUR = 8 // 8:00 AM
export const CALL_END_HOUR = 18 // 6:00 PM
export const CLOSING_SOON_MINUTES = 30

// ── Agent side ──────────────────────────────────────────────────────────────
export const AGENT_TZ = "Asia/Karachi"
// Intl prints Karachi as "GMT+5" in en-US; PKT is what people actually say.
export const AGENT_TZ_ABBR = "PKT"

// ── State / province -> IANA timezone ───────────────────────────────────────
// Multi-zone states map to their main zone — see SPLIT_ZONE_REGIONS.
const EASTERN = "America/New_York"
const CENTRAL = "America/Chicago"
const MOUNTAIN = "America/Denver"
const PACIFIC = "America/Los_Angeles"

const STATE_TIMEZONES: Record<string, string> = {
  // Eastern
  CT: EASTERN, DE: EASTERN, DC: EASTERN, FL: EASTERN, GA: EASTERN, IN: EASTERN, KY: EASTERN,
  ME: EASTERN, MD: EASTERN, MA: EASTERN, MI: EASTERN, NH: EASTERN, NJ: EASTERN, NY: EASTERN,
  NC: EASTERN, OH: EASTERN, PA: EASTERN, RI: EASTERN, SC: EASTERN, VT: EASTERN, VA: EASTERN,
  WV: EASTERN,
  // Central
  AL: CENTRAL, AR: CENTRAL, IL: CENTRAL, IA: CENTRAL, KS: CENTRAL, LA: CENTRAL, MN: CENTRAL,
  MS: CENTRAL, MO: CENTRAL, NE: CENTRAL, ND: CENTRAL, OK: CENTRAL, SD: CENTRAL, TN: CENTRAL,
  TX: CENTRAL, WI: CENTRAL,
  // Mountain
  CO: MOUNTAIN, ID: MOUNTAIN, MT: MOUNTAIN, NM: MOUNTAIN, UT: MOUNTAIN, WY: MOUNTAIN,
  // Arizona: Mountain time all year (no DST)
  AZ: "America/Phoenix",
  // Pacific
  CA: PACIFIC, NV: PACIFIC, OR: PACIFIC, WA: PACIFIC,
  AK: "America/Anchorage",
  HI: "Pacific/Honolulu",
  PR: "America/Puerto_Rico",
  // Canada
  ON: "America/Toronto", QC: "America/Toronto",
  BC: "America/Vancouver",
  AB: "America/Edmonton",
  MB: "America/Winnipeg",
  SK: "America/Regina", // Saskatchewan: Central time all year (no DST)
  NS: "America/Halifax", NB: "America/Halifax", PE: "America/Halifax",
  NL: "America/St_Johns",
  YT: "America/Whitehorse",
  NT: "America/Yellowknife",
  NU: "America/Iqaluit",
}

const REGION_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
  CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas",
  KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts",
  MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico",
  NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico",
  ON: "Ontario", QC: "Quebec", BC: "British Columbia", AB: "Alberta", MB: "Manitoba",
  SK: "Saskatchewan", NS: "Nova Scotia", NB: "New Brunswick", PE: "Prince Edward Island",
  NL: "Newfoundland and Labrador", YT: "Yukon", NT: "Northwest Territories", NU: "Nunavut",
}

const REGION_BY_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(REGION_NAMES).map(([code, name]) => [name.toUpperCase(), code]),
)

// These span two timezones; we use the state's main zone, so the displayed
// time is right for most of the state but not all of it.
const SPLIT_ZONE_REGIONS = new Set([
  "TX", "FL", "IN", "KY", "TN", "ND", "SD", "NE", "KS", "OR", "ID", "MI", "ON", "BC", "NU",
])

const ZONE_LABELS: Record<string, string> = {
  "America/New_York": "Eastern Time",
  "America/Toronto": "Eastern Time",
  "America/Chicago": "Central Time",
  "America/Winnipeg": "Central Time",
  "America/Regina": "Central Time (no DST)",
  "America/Denver": "Mountain Time",
  "America/Edmonton": "Mountain Time",
  "America/Phoenix": "Arizona Time (no DST)",
  "America/Los_Angeles": "Pacific Time",
  "America/Vancouver": "Pacific Time",
  "America/Anchorage": "Alaska Time",
  "Pacific/Honolulu": "Hawaii Time",
  "America/Puerto_Rico": "Atlantic Time",
  "America/Halifax": "Atlantic Time",
  "America/St_Johns": "Newfoundland Time",
  "America/Whitehorse": "Yukon Time",
  "America/Yellowknife": "Mountain Time",
  "America/Iqaluit": "Eastern Time",
}

// ── Area code fallback (only used when there's no usable state) ─────────────
// Approximate: area codes can straddle zones, and numbers port across states.
const AREA_CODES_BY_ZONE: Record<string, string> = {
  "America/New_York":
    "202 203 207 212 215 216 220 223 227 229 234 239 240 248 252 260 267 269 272 276 301 302 304 305 313 315 317 321 326 327 330 332 336 339 347 351 352 380 386 401 404 407 410 412 413 419 423 434 440 443 445 463 470 475 478 484 502 508 513 516 517 518 540 551 561 567 570 571 574 582 585 586 603 606 607 609 610 614 616 617 631 640 646 656 667 678 680 681 689 703 704 706 716 717 718 724 727 732 734 740 743 754 757 762 765 770 771 772 774 781 786 802 803 804 810 813 814 826 828 835 838 839 843 845 848 854 856 857 859 860 862 863 864 865 878 904 906 908 910 912 914 917 919 929 934 937 941 943 947 948 954 959 973 978 980 984 989",
  "America/Toronto":
    "226 249 289 343 365 367 416 418 437 438 450 514 519 548 579 581 613 647 705 753 819 873 905",
  "America/Chicago":
    "205 210 214 217 218 219 224 225 228 251 254 256 262 270 274 281 308 309 312 314 316 318 319 320 325 331 334 337 346 361 364 402 405 409 414 417 430 447 469 479 501 504 507 512 515 531 534 539 563 572 573 580 601 605 608 612 615 618 620 629 630 636 641 651 659 660 662 682 701 708 712 713 715 726 730 731 737 763 769 773 779 785 806 815 816 817 830 832 847 850 870 872 901 903 913 918 920 931 936 938 940 952 956 972 975 979 985",
  "America/Winnipeg": "204 431",
  "America/Regina": "306 474 639",
  "America/Denver": "303 307 385 406 435 505 575 719 720 801 915 970 983 208 986",
  "America/Edmonton": "368 403 587 780 825",
  "America/Phoenix": "480 520 602 623 928",
  "America/Los_Angeles":
    "206 209 213 253 279 310 323 341 360 408 415 424 425 442 458 503 509 510 530 541 559 562 564 619 626 628 650 657 661 669 702 707 714 725 747 760 775 805 818 820 831 840 858 909 916 925 949 951 971",
  "America/Vancouver": "236 250 604 672 778",
  "America/Anchorage": "907",
  "Pacific/Honolulu": "808",
  "America/Puerto_Rico": "787 939",
  "America/Halifax": "506 782 902",
  "America/St_Johns": "709",
}

const AREA_CODE_TZ: Record<string, string> = {}
for (const [tz, codes] of Object.entries(AREA_CODES_BY_ZONE)) {
  for (const code of codes.split(" ")) AREA_CODE_TZ[code] = tz
}
// 850 (FL panhandle) is mostly Central even though Florida's main zone is
// Eastern, so it's deliberately listed under Central above.

export interface ResolvedTimezone {
  tz: string
  source: "state" | "area_code"
  zoneLabel: string // "Eastern Time"
  place: string | null // "Georgia" (null when only an area code was available)
  approximate: boolean
}

function normaliseRegion(state: string | null | undefined): string | null {
  if (!state) return null
  const s = state.trim().toUpperCase().replace(/\./g, "")
  if (STATE_TIMEZONES[s]) return s
  return REGION_BY_NAME[s] ?? null
}

function areaCodeOf(phone: string | null | undefined): string | null {
  if (!phone) return null
  let digits = phone.replace(/\D/g, "")
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1)
  return digits.length === 10 ? digits.slice(0, 3) : null
}

// State/province first; area code only if that gives nothing; otherwise null.
export function resolveTimezone(
  state: string | null | undefined,
  phone: string | null | undefined,
): ResolvedTimezone | null {
  const region = normaliseRegion(state)
  if (region) {
    const tz = STATE_TIMEZONES[region]
    return {
      tz,
      source: "state",
      zoneLabel: ZONE_LABELS[tz] ?? tz,
      place: REGION_NAMES[region] ?? region,
      approximate: SPLIT_ZONE_REGIONS.has(region),
    }
  }
  const code = areaCodeOf(phone)
  const tz = code ? AREA_CODE_TZ[code] : undefined
  if (tz) {
    return { tz, source: "area_code", zoneLabel: ZONE_LABELS[tz] ?? tz, place: null, approximate: true }
  }
  return null
}

// ── Time formatting ─────────────────────────────────────────────────────────
const formatterCache = new Map<string, Intl.DateTimeFormat>()
function fmt(key: string, tz: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const cacheKey = `${key}|${tz}`
  let f = formatterCache.get(cacheKey)
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, ...options })
    formatterCache.set(cacheKey, f)
  }
  return f
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

interface LocalParts {
  weekday: number // 0 = Sunday
  seconds: number // seconds since local midnight
}

function localParts(tz: string, now: Date): LocalParts {
  const parts = fmt("parts", tz, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0"
  return {
    weekday: WEEKDAY_INDEX[get("weekday")] ?? 0,
    seconds: Number(get("hour")) * 3600 + Number(get("minute")) * 60 + Number(get("second")),
  }
}

// "10:42 AM EDT"
export function formatLocalTime(tz: string, now: Date): string {
  return fmt("time-abbr", tz, { hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(now)
}

// "10:42 AM"
export function formatLocalClock(tz: string, now: Date): string {
  return fmt("clock", tz, { hour: "numeric", minute: "2-digit" }).format(now)
}

// "Thursday"
export function formatLocalWeekday(tz: string, now: Date): string {
  return fmt("weekday", tz, { weekday: "long" }).format(now)
}

// "07:42 PM PKT"
export function formatAgentClock(now: Date): string {
  return `${fmt("agent-clock", AGENT_TZ, { hour: "2-digit", minute: "2-digit" }).format(now)} ${AGENT_TZ_ABBR}`
}

// "5:00 PM PKT", prefixed with the weekday when it isn't the same PKT day.
export function formatAgentTimeAt(target: Date, now: Date): string {
  const time = `${fmt("agent-at", AGENT_TZ, { hour: "numeric", minute: "2-digit" }).format(target)} ${AGENT_TZ_ABBR}`
  const day = (d: Date) => fmt("agent-day", AGENT_TZ, { year: "numeric", month: "2-digit", day: "2-digit" }).format(d)
  if (day(target) === day(now)) return time
  return `${fmt("agent-wd", AGENT_TZ, { weekday: "short" }).format(target)} ${time}`
}

// 200 -> "3h 20m", 45 -> "45m", 3000 -> "2d 2h"
export function formatDuration(totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes))
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  const min = m % 60
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`
  if (h > 0) return min > 0 ? `${h}h ${min}m` : `${h}h`
  return `${min}m`
}

// ── Calling window ──────────────────────────────────────────────────────────
export type CallState = "ok" | "closing" | "closed" | "weekend"

export interface CallStatus {
  state: CallState
  // Whole minutes until the window closes (ok / closing only).
  minutesUntilClose: number | null
  // Whole minutes until the next window opens (closed / weekend only).
  minutesUntilOpen: number | null
  // The instant that next window opens (closed / weekend only).
  opensAt: Date | null
}

const isWeekend = (weekday: number) => weekday === 0 || weekday === 6

export function getCallStatus(tz: string, now: Date): CallStatus {
  const { weekday, seconds } = localParts(tz, now)
  const start = CALL_START_HOUR * 3600
  const end = CALL_END_HOUR * 3600

  if (!isWeekend(weekday) && seconds >= start && seconds < end) {
    const left = end - seconds
    return {
      state: left <= CLOSING_SOON_MINUTES * 60 ? "closing" : "ok",
      minutesUntilClose: Math.ceil(left / 60),
      minutesUntilOpen: null,
      opensAt: null,
    }
  }

  // Closed: find the next weekday opening. Today only counts if it hasn't
  // opened yet; otherwise start looking from tomorrow.
  for (let offset = 0; offset <= 7; offset++) {
    const day = (weekday + offset) % 7
    if (isWeekend(day)) continue
    if (offset === 0 && seconds >= start) continue
    const wait = offset * 86400 + start - seconds
    return {
      state: isWeekend(weekday) ? "weekend" : "closed",
      minutesUntilClose: null,
      minutesUntilOpen: Math.ceil(wait / 60),
      opensAt: new Date(now.getTime() + wait * 1000),
    }
  }
  // Unreachable (a week always contains a weekday), but keeps the type total.
  return { state: "closed", minutesUntilClose: null, minutesUntilOpen: null, opensAt: null }
}
