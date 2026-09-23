import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

// Restyled to design/prototype.html `.btn` (DESIGN.md §2.4)
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border font-medium whitespace-nowrap outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)] disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // .btn.primary
        default: "border-[var(--accent)] bg-[var(--accent)] text-white hover:bg-[var(--accent-ink)] hover:border-[var(--accent-ink)]",
        // .btn
        outline: "border-hair bg-surface text-ink hover:border-[var(--muted)]",
        secondary: "border-hair bg-surface text-ink hover:border-[var(--muted)]",
        // .btn.quiet
        ghost: "border-transparent bg-transparent text-ink2 hover:bg-tint",
        destructive: "border-transparent bg-red-bg text-red hover:border-[var(--red)]",
        link: "border-transparent text-accent-ink underline-offset-4 hover:underline",
      },
      size: {
        default: "h-[30px] px-[11px]",
        sm: "h-[25px] px-2 text-xs",
        xs: "h-[22px] px-1.5 text-[11px]",
        lg: "h-9 px-3",
        icon: "size-[30px] text-[var(--muted)] hover:text-ink",
        "icon-xs": "size-[22px]",
        "icon-sm": "size-[25px]",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "outline",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "outline",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
