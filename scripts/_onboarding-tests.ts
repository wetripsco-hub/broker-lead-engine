// Offline checks for lib/onboarding.ts.   npx tsx scripts/_onboarding-tests.ts
import { initialTourStep, firstName, TOUR_STEP_COUNT } from "../lib/onboarding"

let failed = 0
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
  if (!ok) failed++
}

eq("8 steps", TOUR_STEP_COUNT, 8)
eq("new agent starts at 0", initialTourStep(0, false), 0)
eq("resumes saved step", initialTourStep(4, false), 4)
eq("replay starts at 0", initialTourStep(4, true), 0)
eq("null saved step", initialTourStep(null, false), 0)
eq("saved step clamped high", initialTourStep(99, false), 7)
eq("saved step clamped low", initialTourStep(-3, false), 0)
eq("first name", firstName("  Ali Raza Khan "), "Ali")
eq("no name", firstName(null), "your name")

console.log(failed ? `\n${failed} FAILED` : "\nall passed")
if (failed) process.exit(1)
