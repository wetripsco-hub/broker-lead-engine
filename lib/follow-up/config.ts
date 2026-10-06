// Follow-up rules. Change these here — nothing else hardcodes them.
// (The SQL view's own `follow_up_due` column uses the 3 calendar-day default;
// the app derives the flag from the view's raw columns via compute.ts.)

/** Days without a reply before a lead is flagged for follow-up. */
export const FOLLOW_UP_DAYS = 3

/** false = calendar days (weekends count). true = Mon–Fri only. */
export const USE_BUSINESS_DAYS = false

/** Pause between sends when bulk-emailing follow-ups. */
export const FOLLOW_UP_BULK_DELAY_MS = 1_000

export const SNOOZE_SHORT_DAYS = 2
export const SNOOZE_LONG_DAYS = 7
