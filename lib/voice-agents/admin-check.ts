// Role check for sensitive actions. Reads app_metadata.role from the user record
// in the database (service role). app_metadata can only be written with the
// service role; user_metadata is editable by the user, so it is never trusted.

interface AuthAdminLike {
  auth: {
    admin: {
      getUserById(id: string): Promise<{
        data: { user: { app_metadata?: Record<string, unknown> | null } | null } | null
        error: unknown
      }>
    }
  }
}

export async function isAdminInDb(admin: AuthAdminLike, userId: string): Promise<boolean> {
  try {
    const { data, error } = await admin.auth.admin.getUserById(userId)
    if (error || !data?.user) return false
    return data.user.app_metadata?.role === "admin"
  } catch {
    return false
  }
}
