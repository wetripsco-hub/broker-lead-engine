// Copies the SIP password of your Telnyx credential connection into the Retell
// number's outbound trunk config, so Retell can authenticate to Telnyx.
//
//   npx tsx --env-file=.env.local scripts/sync-retell-trunk-password.ts
//   npx tsx --env-file=.env.local scripts/sync-retell-trunk-password.ts "Loadlinker"   (connection name, optional)
//
// Needs TELNYX_API_KEY, RETELL_API_KEY and RETELL_FROM_NUMBER in .env.local.
// Run it yourself: it handles a password, which is never printed or logged.
// It only changes `auth_password` on the Retell number (PATCH update-phone-number);
// agents, inbound/outbound routing and the username are left alone.

export {} // module scope: keeps main() from clashing with other scripts

const retellKey = process.env.RETELL_API_KEY
const telnyxKey = process.env.TELNYX_API_KEY
const fromNumber = process.env.RETELL_FROM_NUMBER ?? "+12142865022"
const wantedName = (process.argv[2] ?? "Loadlinker").trim().toLowerCase()

if (!retellKey || !telnyxKey) {
  console.error("RETELL_API_KEY and TELNYX_API_KEY must be set (use --env-file=.env.local).")
  process.exit(1)
}

async function main() {
  // 1) The number as Retell stores it, and the username its trunk uses.
  const list = await fetch("https://api.retellai.com/list-phone-numbers", { headers: { Authorization: `Bearer ${retellKey}` } })
  if (!list.ok) throw new Error(`Retell list-phone-numbers failed (${list.status})`)
  const want = fromNumber.replace(/\D/g, "")
  const numbers = (await list.json()) as Array<{ phone_number: string; sip_outbound_trunk_config?: { auth_username?: string; termination_uri?: string } }>
  const num = numbers.find((n) => n.phone_number.replace(/\D/g, "") === want)
  if (!num) throw new Error(`${fromNumber} not found in this Retell account`)
  const retellUser = num.sip_outbound_trunk_config?.auth_username
  if (!retellUser) throw new Error("This Retell number has no trunk username configured")

  // 2) The Telnyx credential connection whose username matches.
  const cc = await fetch("https://api.telnyx.com/v2/credential_connections?page[size]=50", { headers: { Authorization: `Bearer ${telnyxKey}` } })
  if (!cc.ok) throw new Error(`Telnyx credential_connections failed (${cc.status})`)
  const conns = ((await cc.json()) as { data?: any[] }).data ?? []
  const conn = conns.find((c) => c.user_name === retellUser) ?? conns.find((c) => String(c.connection_name).trim().toLowerCase() === wantedName)
  if (!conn) throw new Error("No Telnyx credential connection matches the username Retell is using")
  if (conn.user_name !== retellUser) {
    throw new Error(`The Telnyx connection "${String(conn.connection_name).trim()}" has a different username than Retell's trunk. Fix the username in Retell first.`)
  }
  const password: string | undefined = conn.password
  if (!password) {
    throw new Error(`Telnyx did not return a password for "${String(conn.connection_name).trim()}". Copy it from the Telnyx portal into Retell by hand.`)
  }

  // 3) Update only the password on the Retell number.
  const res = await fetch(`https://api.retellai.com/update-phone-number/${encodeURIComponent(num.phone_number)}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${retellKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ auth_password: password }),
  })
  if (!res.ok) throw new Error(`Retell update-phone-number failed (${res.status})`)
  console.log(`Updated the trunk password on ${fromNumber} from Telnyx connection "${String(conn.connection_name).trim()}". Now try an AI call again.`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Unexpected error")
  process.exit(1)
})
