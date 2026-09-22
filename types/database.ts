export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type LeadStage = "new" | "contacted" | "interested" | "converted" | "dead"
export type OutreachChannel = "email" | "call" | "sms"
export type OutreachStatus = "pending" | "sent" | "delivered" | "failed" | "no_answer" | "answered"
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
          mc_number: string
          dot_number: string | null
          company_name: string
          contact_name: string | null
          email: string | null
          phone: string | null
          address_line1: string | null
          address_line2: string | null
          city: string | null
          state: string | null
          zip: string | null
          authority_status: string | null
          registration_date: string | null
          ingestion_run_id: string | null
          first_seen_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          mc_number: string
          dot_number?: string | null
          company_name: string
          contact_name?: string | null
          email?: string | null
          phone?: string | null
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          state?: string | null
          zip?: string | null
          authority_status?: string | null
          registration_date?: string | null
          ingestion_run_id?: string | null
          first_seen_at?: string
          updated_at?: string
        }
        Update: Partial<Database["public"]["Tables"]["brokers"]["Insert"]>
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
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          broker_id: string
          stage?: LeadStage
          assigned_agent_id?: string | null
          notes?: string | null
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
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          subject: string
          body: string
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
