// First-login walkthrough for agents (app/onboarding/tour).

export const TOUR_STEP_COUNT = 8

/** Where a tour opens: replay always starts at the beginning, otherwise resume the saved step. */
export function initialTourStep(savedStep: number | null | undefined, replay: boolean): number {
  if (replay) return 0
  const n = Number.isFinite(savedStep) ? Math.floor(savedStep as number) : 0
  return Math.max(0, Math.min(TOUR_STEP_COUNT - 1, n))
}

export function firstName(fullName: string | null | undefined): string {
  return (fullName ?? "").trim().split(/\s+/)[0] || "your name"
}
