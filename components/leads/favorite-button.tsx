"use client"

import { useState, useTransition } from "react"
import { Star } from "lucide-react"
import { toast } from "sonner"
import { setLeadFavorite } from "@/app/(dashboard)/leads/favorite-actions"

interface Props {
  leadId: string
  favorite: boolean
  /** Called right away with the new value (and again with the old one if saving fails). */
  onChange?: (favorite: boolean) => void
  size?: "sm" | "md"
  className?: string
}

/** A star toggle. Optimistic: it flips instantly and flips back with a message if saving fails. */
export function FavoriteButton({ leadId, favorite, onChange, size = "sm", className = "" }: Props) {
  const [optimistic, setOptimistic] = useState<boolean | null>(null)
  const [pending, startTransition] = useTransition()
  const on = optimistic ?? favorite
  const dim = size === "md" ? "size-5" : "size-4"

  function toggle(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (pending) return
    const next = !on
    setOptimistic(next)
    onChange?.(next)
    startTransition(async () => {
      const { error } = await setLeadFavorite(leadId, next)
      if (error) {
        setOptimistic(!next)
        onChange?.(!next)
        toast.error(error)
      } else {
        setOptimistic(null)
      }
    })
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      aria-label={on ? "Remove from favorites" : "Add to favorites"}
      title={on ? "Remove from favorites" : "Add to favorites"}
      className={`inline-flex shrink-0 items-center justify-center rounded-md p-1 text-muted-foreground/60 transition-[color,transform] duration-150 ease-[var(--ease-out)] hover:text-amber-500 active:scale-90 ${className}`}
    >
      <Star className={`${dim} ${on ? "fill-amber-400 text-amber-500" : ""}`} aria-hidden />
    </button>
  )
}
