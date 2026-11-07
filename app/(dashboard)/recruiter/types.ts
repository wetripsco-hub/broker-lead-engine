export const RECRUIT_STAGES = ["new", "emailed", "replied", "video_received", "interview", "hired", "rejected"] as const
export type RecruitStage = (typeof RECRUIT_STAGES)[number]

export const STAGE_LABEL: Record<RecruitStage, string> = {
  new: "New",
  emailed: "Emailed",
  replied: "Replied",
  video_received: "Video received",
  interview: "Interview",
  hired: "Hired",
  rejected: "Rejected",
}

export interface Recruit {
  id: string
  name: string
  email: string
  source: string | null
  stage: RecruitStage
  notes: string | null
  unread: boolean
  last_emailed_at: string | null
  last_reply_at: string | null
  follow_up_due_at: string | null
  agent_id: string | null
  created_at: string
}

export interface RecruitTemplate {
  id: string
  name: string
  subject: string
  body: string
  updated_at: string
}

export interface RecruitMessage {
  id: string
  direction: "outbound" | "inbound"
  subject: string | null
  body_text: string | null
  message_id: string | null
  sent_at: string | null
  received_at: string | null
  created_at: string
}

export interface RecruitMedia {
  id: string
  message_id: string
  source_type: "attachment" | "link"
  provider: string
  original_url: string | null
  embed_url: string | null
  file_name: string | null
  mime_type: string | null
  size_bytes: number | null
  status: "available" | "embedded" | "link" | "skipped"
}

export interface ThreadData {
  recruit: Recruit
  messages: RecruitMessage[]
  media: RecruitMedia[]
}

export interface BatchProgress {
  total: number
  queued: number
  sending: number
  sent: number
  failed: number
  cancelled: number
  failures: Array<{ email: string; error: string }>
}
