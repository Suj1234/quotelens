import * as React from "react"
import { cn } from "cn"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "w-full min-w-0 rounded-md border border-hair bg-surface px-[9px] py-[7px] text-[13.5px] text-ink outline-none placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-45 aria-invalid:border-[var(--red)]",
        className
      )}
      {...props}
    />
  )
}

export { Input }
