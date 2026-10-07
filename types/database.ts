export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type EmailTemplateType = "initial" | "follow_up"
export type LeadStage = "new" | "contacted" | "interested" | "converted" | "dead"
export type OutreachChannel = "email" | "call" | "sms" | "ai_call"
export type OutreachStatus = "pending" | "sent" | "delivered" | "opened" | "clicked" | "failed" | "no_answer" | "answered"
export type UserRole = "admin" | "agent"

export interface Database {
  public: {
    Tables: {
      agents: {
        Row: {
          id: string
          user_id: string
          name: string
          twilio_identity: string | null
          telnyx_credential_id: string | null
          commission_rate: number | null
          email: string | null
          active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          name: string
          twilio_identity?: string | null
          telnyx_credential_id?: string | null
          commission_rate?: number | null
          email?: string | null
          active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          name?: string
          twilio_identity?: string | null
          telnyx_credential_id?: string | null
          commission_rate?: number | null
          updated_at?: string
        }
      }
      brokers: {
        Row: {
          id: string
          mc_number: string | null
          dot_number: string | null
          company_name: string
          contact_name: string | null
          email: string | null
          phone: string | null
          phone_e164: string | null
          address_line1: string | null
          address_line2: string | null
          city: string | null
          state: string | null
          zip: string | null
          authority_status: string | null
          registration_date: string | null
          ingestion_run_id: string | null
          broker_type: "property" | "household_goods" | null
          email_confidence: "found" | "guessed" | "not_found" | null
          dba_name: string | null
          business_email: string | null
          usdot_status: string | null
          // Free text: MOTUS can report a status we haven't catalogued yet.
          mc_status: string | null
          authority_type: "property" | "household_goods" | null
          first_seen_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          mc_number?: string | null
          dot_number?: string | null
          company_name: string
          contact_name?: string | null
          email?: string | null
          phone?: string | null
          phone_e164?: string | null
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          state?: string | null
          zip?: string | null
          authority_status?: string | null
          registration_date?: string | null
          ingestion_run_id?: string | null
          broker_type?: "property" | "household_goods" | null
          email_confidence?: "found" | "guessed" | "not_found" | null
          dba_name?: string | null
          business_email?: string | null
          usdot_status?: string | null
          mc_status?: string | null
          authority_type?: "property" | "household_goods" | null
          first_seen_at?: string
          updated_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["brokers"]["Insert"]>
      }
      broker_officials: {
        Row: {
          id: string
          broker_id: string
          official_name: string
          title: string | null
          telephone: string | null
          email: string | null
          created_at: string
        }
        Insert: {
          id?: string
          broker_id: string
          official_name: string
          title?: string | null
          telephone?: string | null
          email?: string | null
          created_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["broker_officials"]["Insert"]>
      }
      daily_ingestion_log: {
        Row: {
          id: string
          run_date: string
          fetched_count: number
          new_count: number
          updated_count: number
          status: "running" | "success" | "error"
          error_message: string | null
          active_count: number
          pending_count: number
          skipped_count: number
          email_count: number
          started_at: string
          finished_at: string | null
        }
        Insert: {
          id?: string
          run_date: string
          fetched_count?: number
          new_count?: number
          updated_count?: number
          status: "running" | "success" | "error"
          error_message?: string | null
          active_count?: number
          pending_count?: number
          skipped_count?: number
          email_count?: number
          started_at?: string
          finished_at?: string | null
        }
        Update: Partial<Database["public"]["Tables"]["daily_ingestion_log"]["Insert"]>
      }
      leads: {
        Row: {
          id: string
          broker_id: string
          stage: LeadStage
          assigned_agent_id: string | null
          notes: string | null
          follow_up_snoozed_until: string | null
          ai_call_consent: boolean
          ai_call_consent_source: string | null
          ai_call_consent_at: string | null
          do_not_call: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          broker_id: string
          stage?: LeadStage
          assigned_agent_id?: string | null
          notes?: string | null
          follow_up_snoozed_until?: string | null
          ai_call_consent?: boolean
          ai_call_consent_source?: string | null
          ai_call_consent_at?: string | null
          do_not_call?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["leads"]["Insert"]>
      }
      outreach_events: {
        Row: {
          id: string
          lead_id: string | null
          agent_id: string
          channel: OutreachChannel
          status: OutreachStatus
          message_body: string | null
          recording_url: string | null
          transcript: string | null
          external_id: string | null
          direction: "inbound" | "outbound"
          direct_number: string | null
          direct_number_e164: string | null
          from_number: string | null
          to_number: string | null
          read_at: string | null
          opened_at: string | null
          open_count: number
          clicked_at: string | null
          click_count: number
          subject: string | null
          body_html: string | null
          from_email: string | null
          to_email: string | null
          message_id: string | null
          in_reply_to: string | null
          email_references: string | null
          received_at: string | null
          send_error: string | null
          ai_summary: string | null
          follow_up_date: string | null
          provider: string | null
          provider_call_id: string | null
          call_status: string | null
          sentiment: string | null
          disposition: string | null
          duration_seconds: number | null
          cost_usd: number | null
          ai_callback_time: string | null
          occurred_at: string
        }
        Insert: {
          id?: string
          lead_id?: string | null
          agent_id: string
          channel: OutreachChannel
          status?: OutreachStatus
          message_body?: string | null
          recording_url?: string | null
          transcript?: string | null
          external_id?: string | null
          direction?: "inbound" | "outbound"
          direct_number?: string | null
          direct_number_e164?: string | null
          from_number?: string | null
          to_number?: string | null
          read_at?: string | null
          opened_at?: string | null
          open_count?: number
          clicked_at?: string | null
          click_count?: number
          subject?: string | null
          body_html?: string | null
          from_email?: string | null
          to_email?: string | null
          message_id?: string | null
          in_reply_to?: string | null
          email_references?: string | null
          received_at?: string | null
          send_error?: string | null
          occurred_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["outreach_events"]["Insert"]>
      }
      email_templates: {
        Row: {
          id: string
          name: string
          subject: string
          body: string
          type: EmailTemplateType
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          subject: string
          body: string
          type?: EmailTemplateType
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["email_templates"]["Insert"]>
      }
    }
    Functions: {
      current_agent_id: { Args: Record<never, never>; Returns: string }
      is_admin: { Args: Record<never, never>; Returns: boolean }
    }
    Enums: {
      lead_stage: LeadStage
      outreach_channel: OutreachChannel
      outreach_status: OutreachStatus
    }
  }
}
