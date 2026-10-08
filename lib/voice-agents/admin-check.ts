// Role check for sensitive overrides. Reads the user record from the database
// (service role) instead of trusting the session token or anything the browser
// sent, so a stale or tampered token can't grant admin rights.

interface AuthAdminLike {
  auth: {
    admin: {
      getUserById(id: string): Promise<{
        data: { user: { user_metadata?: Record<string, unknown> | null } | null } | null
        error: unknown
      }>
    }
  }
}

export async function isAdminInDb(admin: AuthAdminLike, userId: string): Promise<boolean> {
  try {
    const { data, error } = await admin.auth.admin.getUserById(userId)
    if (error || !data?.user) return false
    return data.user.user_metadata?.role === "admin"
  } catch {
    return false
  }
}
