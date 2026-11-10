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
    "hover:-translate-y-px active:translate-y-0 active:scale-[0.97]",
    "disabled:pointer-events-none disabled:opacity-40",
    "data-[busy=true]:pointer-events-none",
  ],
  {
    variants: {
      variant: {
        primary: "bg-accent-strong text-on-accent shadow-1 hover:brightness-110",
        secondary: "border border-line-2 bg-surface-2 text-fg-1 hover:bg-surface-3",
        ghost: "text-fg-2 hover:bg-surface-2 hover:text-fg-1",
        gain: "bg-gain text-on-semantic shadow-1 hover:brightness-110",
        loss: "bg-loss text-on-semantic shadow-1 hover:brightness-110",
        danger: "border border-loss/50 text-loss hover:bg-loss-soft",
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
