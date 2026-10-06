"use client"

// Shared Copilot on/off switch: used in the lead page next to the Call button
// (before dialing) and in the Copilot panel header (before and during a call).
export function CopilotSwitch({
  on,
  onChange,
  label = "Copilot",
}: {
  on: boolean
  onChange: (next: boolean) => void
  label?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="inline-flex items-center gap-2 text-xs text-muted-foreground transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.97]"
    >
      <span className={on ? "font-medium text-foreground" : ""}>{label}</span>
      <span
        className={`relative h-5 w-9 rounded-full transition-colors duration-200 ease-[var(--ease-out)] ${
          on ? "bg-blue-600" : "bg-muted-foreground/30"
        }`}
      >
        <span
          className={`absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow transition-transform duration-200 ease-[var(--ease-out)] ${
            on ? "translate-x-4" : ""
          }`}
        />
      </span>
      <span className="w-5 tabular-nums">{on ? "On" : "Off"}</span>
    </button>
  )
}
