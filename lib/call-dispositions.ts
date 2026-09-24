export type DispositionKey =
  | "no_answer"
  | "left_voicemail"
  | "answered_interested"
  | "answered_not_interested"
  | "callback"
  | "wrong_number"

export const DISPOSITION_LABEL: Record<DispositionKey, string> = {
  no_answer:               "No answer",
  left_voicemail:          "Left voicemail",
  answered_interested:     "Answered — interested",
  answered_not_interested: "Answered — not interested",
  callback:                "Call back later",
  wrong_number:            "Wrong number",
}

export const DISPOSITION_STATUS: Record<DispositionKey, "answered" | "no_answer"> = {
  no_answer:               "no_answer",
  left_voicemail:          "no_answer",
  answered_interested:     "answered",
  answered_not_interested: "answered",
  callback:                "answered",
  wrong_number:            "no_answer",
}

export const DISPOSITION_STAGE: Record<DispositionKey, string | null> = {
  no_answer:               null,
  left_voicemail:          "contacted",
  answered_interested:     "interested",
  answered_not_interested: "contacted",
  callback:                "contacted",
  wrong_number:            null,
}
