// Who may listen to an agent call recording. The bucket is private, so this is the only way in.
// The row is read through the signed-in user's session (row-level security decides first).
// RLS follows the lead's current assignment, so an agent is also limited to their own calls:
// a lead reassigned to them does not open the previous agent's recordings.

export interface RecordingAccessDeps {
  userId(): Promise<string | null>
  /** Must use the signed-in user's client, never the service role. */
  readEvent(eventId: string): Promise<{ agent_id: string; recording_path: string | null } | null>
  isAdmin(userId: string): Promise<boolean>
  ownAgentId(userId: string): Promise<string | null>
  signUrl(path: string, download: boolean): Promise<string | null>
}

const NOT_AVAILABLE = "Recording not available"

export async function resolveRecordingUrl(
  eventId: string,
  download: boolean,
  deps: RecordingAccessDeps,
): Promise<{ url?: string; error?: string }> {
  const userId = await deps.userId()
  if (!userId) return { error: "Not authenticated" }

  const event = await deps.readEvent(eventId)
  if (!event?.recording_path) return { error: NOT_AVAILABLE }

  if (!(await deps.isAdmin(userId))) {
    const ownAgentId = await deps.ownAgentId(userId)
    if (!ownAgentId || ownAgentId !== event.agent_id) return { error: NOT_AVAILABLE }
  }

  const url = await deps.signUrl(event.recording_path, download)
  return url ? { url } : { error: NOT_AVAILABLE }
}
