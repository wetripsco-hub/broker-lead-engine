// Wiring checks for favorites (the row-level-security behaviour was tested against
// the real database in a rolled-back transaction when the feature was built).
//   npx tsx scripts/_favorites-tests.ts
import { readFileSync } from "fs"

export {}
let failed = 0
function check(name: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`)
  if (!ok) failed++
}
const read = (p: string) => readFileSync(p, "utf8")

const sql = read("supabase/migrations/20261002000001_lead_favorites.sql")
check("migration: table keyed by (user, lead), deleted with the lead", /primary key \(user_id, lead_id\)/.test(sql) && /references public\.leads\(id\) on delete cascade/.test(sql))
check("migration: row-level security on, three own-rows policies", /enable row level security/.test(sql) && (sql.match(/create policy/g) ?? []).length === 3 && (sql.match(/user_id = auth\.uid\(\)/g) ?? []).length >= 3)
check("migration: can only star a lead you can see", /exists \(select 1 from public\.leads l where l\.id = lead_id\)/.test(sql))
check("migration: no policy lets one user read another's stars", !/using \(true\)|is_admin\(\)/.test(sql))

const action = read("app/(dashboard)/leads/favorite-actions.ts")
check("action: scoped to the signed-in user, signed-out refused", /user_id: user\.id/.test(action) && /\.eq\("user_id", user\.id\)/.test(action) && /Not signed in/.test(action))
check("action: lead id is validated", /UUID\.test\(leadId\)/.test(action))
check("action: a missing table gives a clear message, not a crash", /42P01/.test(action) && /migration/.test(action))

const page = read("app/(dashboard)/leads/page.tsx")
check("list page: loads the user's stars and tolerates a missing table", /lead_favorites/.test(page) && /favRaw \?\? \[\]/.test(page) && /favoriteIds=\{favoriteIds\}/.test(page))
const list = read("app/(dashboard)/leads/leads-list-client.tsx")
check("list: star on every row, Favorites filter and 'Favorites first' sort", /<FavoriteButton/.test(list) && /Favorites \(\{favoriteCount\}\)/.test(list) && /value="favorites"/.test(list))
check("list: filter uses the live set, so a click shows at once", /favoritesOnly && !favorites\.has\(l\.id\)/.test(list))
check("list: the star sits above the row link so clicking it does not open the lead", /pointer-events-auto relative z-10/.test(list))
const lead = read("app/(dashboard)/leads/[id]/page.tsx")
check("lead page: star next to the company name", /<FavoriteButton leadId=\{lead\.id\}/.test(lead) && /lead_favorites/.test(lead))
const btn = read("components/leads/favorite-button.tsx")
check("button: optimistic, and reverts with a message on failure", /setOptimistic\(!next\)/.test(btn) && /toast\.error/.test(btn) && /stopPropagation/.test(btn))

console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) FAILED.`)
process.exit(failed === 0 ? 0 : 1)
