import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: ReactNode;
  error?: string;
}

/** Labelled text input with hint and error text wired up for screen readers. */
export function Field({ label, hint, error, className, id, ...props }: FieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;
  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="block label-pixel text-fg-2">
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          "h-12 w-full rounded-md border-2 border-line-2 bg-surface-2 px-3.5 text-base text-fg-1 sunken placeholder:text-fg-3",
          "transition-colors duration-fast ease-standard hover:border-fg-3",
          "outline-2 outline-offset-0 outline-transparent focus:border-accent focus:outline-accent-soft",
          error && "border-loss focus:border-loss focus:outline-loss-soft",
          className,
        )}
        {...props}
      />
      {error ? (
        <p id={`${inputId}-error`} role="alert" className="text-sm text-loss">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="text-sm text-fg-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
