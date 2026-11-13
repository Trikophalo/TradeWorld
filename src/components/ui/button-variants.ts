import { cva, type VariantProps } from "class-variance-authority";

/**
 * Button look as plain class names, so links can share it:
 * `<Link className={buttonVariants({ variant: "secondary" })}>`.
 * Lives outside button.tsx because that file is a Client Component.
 */
export const buttonVariants = cva(
  [
    "relative inline-flex shrink-0 items-center justify-center gap-2 overflow-hidden focus-ring select-none",
    "font-pixel tracking-wide whitespace-nowrap uppercase",
    "transition duration-fast ease-standard",
    // A key you can press (ADR-108): light on top, a darker edge below that disappears when it goes down.
    "pb-0.5 hover:-translate-y-px active:translate-y-0.5 active:duration-instant",
    "before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-shine",
    "after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] after:origin-bottom after:bg-shade",
    "after:transition-transform after:duration-instant active:after:scale-y-0",
    "disabled:pointer-events-none disabled:opacity-40",
    "data-[busy=true]:pointer-events-none",
  ],
  {
    variants: {
      variant: {
        primary: "bg-accent-strong text-on-accent hover:brightness-110",
        secondary: "border border-line-2 bg-surface-2 text-fg-1 hover:bg-surface-3",
        ghost: "text-fg-2 before:hidden after:hidden hover:bg-surface-2 hover:text-fg-1",
        gain: "bg-gain text-on-semantic hover:brightness-110",
        loss: "bg-loss text-on-semantic hover:brightness-110",
        danger: "border border-loss/50 text-loss before:hidden after:hidden hover:bg-loss-soft",
      },
      size: {
        sm: "h-8 rounded-sm px-3 text-2xs",
        md: "h-11 rounded-md px-4 text-xs",
        lg: "h-13 rounded-md px-6 text-sm",
        icon: "size-11 rounded-md",
      },
      block: { true: "w-full" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonVariantProps = VariantProps<typeof buttonVariants>;
