"use client";

import { AnimatePresence, motion } from "motion/react";
import { formatMoney, formatMoneyShort } from "@/lib/format";
import { DURATION, EASE } from "@/lib/motion";
import { useClock } from "@/lib/use-now";
import { cn } from "@/lib/utils";

/**
 * Money in short form ("15k €") with the exact amount on hover and for screen readers (ADR-072).
 * The short text only changes when the next unit is full, and then pops in.
 */
export function ShortMoney({ cents, className }: { cents: number; className?: string }) {
  const exact = formatMoney(cents);
  const short = formatMoneyShort(cents);
  return (
    <span title={exact} aria-label={exact} className={cn("relative inline-flex nums", className)}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={short}
          aria-hidden
          initial={{ opacity: 0, y: "40%" }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: "-40%" }}
          transition={{ duration: DURATION.fast, ease: EASE.out }}
        >
          {short}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/**
 * A running counter: `cents` was true at `asOf`, and grows by `perHourCents` (ADR-072). Only the display runs;
 * the server books every hour.
 */
export function LiveMoney({
  cents,
  perHourCents,
  asOf,
  className,
}: {
  cents: number;
  perHourCents: number;
  asOf: string;
  className?: string;
}) {
  const now = useClock();
  const elapsedHours = now === null ? 0 : Math.max(0, (now - Date.parse(asOf)) / 3_600_000);
  return <ShortMoney cents={Math.round(cents + perHourCents * elapsedHours)} className={className} />;
}
