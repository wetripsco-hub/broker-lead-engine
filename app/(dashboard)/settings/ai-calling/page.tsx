import { readFile } from "fs/promises"
import path from "path"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { loadAiCallSettings } from "@/lib/voice-agents/settings"
import { AiCallingClient } from "./ai-calling-client"

export default async function AiCallingSettingsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")
  if (user.user_metadata?.role !== "admin") redirect("/leads")

  const settings = await loadAiCallSettings(supabase)

  let prompt = ""
  try {
    prompt = await readFile(path.join(process.cwd(), "prompts", "ai-caller.md"), "utf8")
  } catch {
    prompt = "(prompts/ai-caller.md not found in this deployment)"
  }

  // Non-secret deployment config, shown read-only. The API key is never read here.
  const env = {
    provider: process.env.VOICE_PROVIDER ?? "retell",
    agentId: process.env.RETELL_AGENT_ID ?? null,
    fromNumber: process.env.RETELL_FROM_NUMBER ?? null,
    keySet: Boolean(process.env.RETELL_API_KEY),
    transferSet: Boolean(process.env.AI_CALL_TRANSFER_NUMBER),
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <AiCallingClient settings={settings} env={env} prompt={prompt} />
    </div>
  )
}
