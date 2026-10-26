// Call outcomes. The first group is what a caller picks after a call (the nine outcomes of the
// call script, section 9, plus "No answer" for calls nobody picked up). The legacy keys stay
// valid so old rows, the export and the AI-call results keep working; they are not offered in
// the menu any more.

export type DispositionKey =
  | "demo_booked"
  | "trial_link_sent"
  | "marketplace_link_sent"
  | "callback"
  | "email_requested"
  | "left_voicemail"
  | "not_interested"
  | "do_not_call"
  | "wrong_number"
  | "no_answer"
  // legacy / AI-call values
  | "answered_interested"
  | "answered_not_interested"

/** What a caller can choose in the outcome menu, in this order. */
export const DISPOSITION_MENU: DispositionKey[] = [
  "demo_booked",
  "trial_link_sent",
  "marketplace_link_sent",
  "callback",
  "email_requested",
  "left_voicemail",
  "not_interested",
  "do_not_call",
  "wrong_number",
  "no_answer",
]

export const DISPOSITION_LABEL: Record<DispositionKey, string> = {
  demo_booked:             "Demo booked",
  trial_link_sent:         "Trial link sent",
  marketplace_link_sent:   "Marketplace link sent",
  callback:                "Callback requested",
  email_requested:         "Email requested",
  left_voicemail:          "Voicemail left",
  not_interested:          "Not interested",
  do_not_call:             "Do not call",
  wrong_number:            "Wrong number",
  no_answer:               "No answer",
  answered_interested:     "Answered — interested",
  answered_not_interested: "Answered — not interested",
}

export const DISPOSITION_STATUS: Record<DispositionKey, "answered" | "no_answer"> = {
  demo_booked:             "answered",
  trial_link_sent:         "answered",
  marketplace_link_sent:   "answered",
  callback:                "answered",
  email_requested:         "answered",
  left_voicemail:          "no_answer",
  not_interested:          "answered",
  do_not_call:             "answered",
  wrong_number:            "no_answer",
  no_answer:               "no_answer",
  answered_interested:     "answered",
  answered_not_interested: "answered",
}

export const DISPOSITION_STAGE: Record<DispositionKey, string | null> = {
  demo_booked:             "interested",
  trial_link_sent:         "interested",
  marketplace_link_sent:   "contacted",
  callback:                "contacted",
  email_requested:         "contacted",
  left_voicemail:          "contacted",
  not_interested:          "contacted",
  do_not_call:             "dead",
  wrong_number:            null,
  no_answer:               null,
  answered_interested:     "interested",
  answered_not_interested: "contacted",
}

/** Outcomes that mean the person agreed on the call to be texted: the date is recorded (TCPA). */
export const SMS_PERMISSION_OUTCOMES: DispositionKey[] = ["trial_link_sent", "marketplace_link_sent"]

export const isSmsPermissionOutcome = (d: DispositionKey) => SMS_PERMISSION_OUTCOMES.includes(d)
