import type { ReactNode } from "react";

/** Body of one rule: explanation, a worked example and where it shows up in the game. */
export function RuleBody({
  text,
  example,
  where,
  labels,
  children,
}: {
  text: string;
  example: string;
  where: string;
  labels: { example: string; where: string };
  children?: ReactNode;
}) {
  return (
    <div className="space-y-3 lg:pl-13">
      <p className="text-pretty text-fg-1">{text}</p>
      {children}
      <div className="rounded-md bg-surface-2 px-4 py-3">
        <p className="label-pixel text-accent">{labels.example}</p>
        <p className="mt-1 nums text-pretty text-fg-1">{example}</p>
      </div>
      <p className="text-sm text-pretty text-fg-3">
        <span className="font-medium text-fg-2">{labels.where}:</span> {where}
      </p>
    </div>
  );
}
