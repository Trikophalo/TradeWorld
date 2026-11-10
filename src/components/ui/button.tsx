"use client";

import { AnimatePresence, motion } from "motion/react";
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { DURATION, EASE } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { buttonVariants, type ButtonVariantProps } from "./button-variants";

export type ButtonState = "idle" | "loading" | "success";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, ButtonVariantProps {
  /** `loading` shows the pixel loader, `success` a short check mark. Width never changes. */
  state?: ButtonState;
  icon?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  className,
  variant,
  size,
  block,
  state = "idle",
  icon,
  children,
  type = "button",
  ...props
}: ButtonProps) {
  const busy = state !== "idle";
  return (
    <button
      type={type}
      data-busy={busy}
      aria-busy={state === "loading"}
      className={cn(buttonVariants({ variant, size, block }), className)}
      {...props}
    >
      <span
        className={cn(
          "inline-flex items-center gap-2 transition duration-fast ease-standard",
          busy && "scale-90 opacity-0",
        )}
      >
        {icon}
        {children}
      </span>
      <AnimatePresence initial={false}>
        {busy && (
          <motion.span
            key={state}
            className="absolute inset-0 grid place-items-center"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ duration: DURATION.fast, ease: EASE.out }}
          >
            {state === "loading" ? <PixelLoader /> : <PixelCheck />}
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
}

/** Three blinking pixels: the only "spinner" in the app, used inside buttons. */
export function PixelLoader({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex gap-1", className)} role="status" aria-label="Lädt">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="size-1.5 bg-current"
          animate={{ opacity: [0.25, 1, 0.25], y: [0, -2, 0] }}
          transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.12, ease: "easeInOut" }}
        />
      ))}
    </span>
  );
}

export function PixelCheck({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 9 7"
      width="18"
      height="14"
      shapeRendering="crispEdges"
      className={cn("pixelated", className)}
      aria-hidden
    >
      <path
        fill="currentColor"
        d="M7 0h2v2H7zM6 1h2v2H6zM5 2h2v2H5zM4 3h2v2H4zM3 4h2v2H3zM0 2h2v2H0zM1 3h2v2H1zM2 4h2v3H2z"
      />
    </svg>
  );
}
