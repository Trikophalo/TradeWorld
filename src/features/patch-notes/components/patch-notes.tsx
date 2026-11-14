"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { NEWSPAPER } from "@/components/pixel/art";
import { PixelIcon } from "@/components/pixel/pixel-icon";
import { Accordion } from "@/components/ui/accordion";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { Sheet } from "@/components/ui/sheet";
import { PATCH_NOTES } from "@/config/patch-notes.generated";
import { haptic } from "@/lib/haptics";
import { useMediaQuery } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { entryIds, inlineRuns, unseenSince, type PatchNoteRelease } from "../changelog";
import { usePatchNotesSeen } from "../seen";

const NEWEST_ID = entryIds(PATCH_NOTES)[0] ?? null;
const releaseDate = new Intl.DateTimeFormat("de-DE", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** True when the changelog has an entry newer than the last one the player opened. Only after hydration. */
export function usePatchNotesUnseen(): boolean {
  const { ready, seenId, load } = usePatchNotesSeen();
  useEffect(load, [load]);
  return ready && NEWEST_ID !== null && seenId !== NEWEST_ID;
}

/**
 * The patch notes in the top bar (ADR-137): a newspaper with a blue dot while there is something new. Opens a sheet on
 * phones and a centred window on desktop; opening counts as read.
 */
export function PatchNotesButton({ className }: { className?: string }) {
  const t = useTranslations("patchNotes");
  const unseen = usePatchNotesUnseen();
  const markSeen = usePatchNotesSeen((state) => state.markSeen);
  const [open, setOpen] = useState(false);
  // Which entries were new when the panel opened; kept until it closes, so their dots do not vanish while reading.
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());

  const onOpenChange = (next: boolean) => {
    if (next && NEWEST_ID) {
      setFresh(new Set(unseenSince(PATCH_NOTES, usePatchNotesSeen.getState().seenId) ?? []));
      markSeen(NEWEST_ID);
    }
    setOpen(next);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          haptic("tap");
          onOpenChange(true);
        }}
        disabled={NEWEST_ID === null}
        aria-label={unseen ? t("labelUnseen") : t("label")}
        data-testid="patch-notes-button"
        className={cn(
          "relative flex h-10 shrink-0 items-center gap-2 rounded-md px-1 text-sm text-fg-2 focus-ring transition duration-fast hover:bg-surface-2 hover:text-fg-1 active:scale-95 disabled:pointer-events-none disabled:opacity-50 sm:px-2.5",
          className,
        )}
      >
        <PixelIcon {...NEWSPAPER} scale={2} />
        <span className="hidden xl:inline">{t("label")}</span>
        {unseen && (
          <span
            className="absolute top-1.5 right-0.5 grid size-2.5 place-items-center sm:right-1.5"
            data-testid="patch-notes-dot"
          >
            <span className="absolute size-full rounded-pill bg-info motion-safe:animate-ping" />
            <span className="relative size-2.5 rounded-pill bg-info ring-2 ring-bg" />
          </span>
        )}
      </button>
      <PatchNotesPanel open={open} onOpenChange={onOpenChange} fresh={fresh} />
    </>
  );
}

export function PatchNotesPanel({
  open,
  onOpenChange,
  fresh,
  releases = PATCH_NOTES,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fresh: ReadonlySet<string>;
  releases?: readonly PatchNoteRelease[];
}) {
  const t = useTranslations("patchNotes");
  // Phones get the bottom sheet (touch, safe areas); the centred window is for desktops, as with the NFT detail.
  const desktop = useMediaQuery("(min-width: 1024px)");
  const frame = { open, onOpenChange, title: t("title"), description: t("intro") };
  const list = <PatchNotesList releases={releases} fresh={fresh} />;
  return desktop ? (
    <Modal {...frame} className="w-[min(96vw,760px)]">
      {list}
    </Modal>
  ) : (
    <Sheet {...frame}>{list}</Sheet>
  );
}

/** Releases newest first; only the newest starts open, closed ones render nothing until opened. */
export function PatchNotesList({
  releases = PATCH_NOTES,
  fresh,
}: {
  releases?: readonly PatchNoteRelease[];
  fresh: ReadonlySet<string>;
}) {
  const t = useTranslations("patchNotes");
  const newest = releases[0];
  if (!newest) {
    return (
      <EmptyState art={<PixelIcon {...NEWSPAPER} scale={4} />} title={t("emptyTitle")} description={t("emptyText")} />
    );
  }
  return (
    <div data-testid="patch-notes-list">
      <Accordion
        defaultOpen={[`patch-${newest.id}`]}
        items={releases.map((release) => {
          const newCount = release.entries.filter((entry) => fresh.has(entry.id)).length;
          const summary = [
            release.date ? releaseDate.format(new Date(`${release.date}T00:00:00Z`)) : null,
            t("count", { count: release.entries.length }),
            newCount > 0 ? t("fresh", { count: newCount }) : null,
          ]
            .filter(Boolean)
            .join(" · ");
          return {
            id: `patch-${release.id}`,
            title: release.title,
            summary,
            content: <ReleaseNotes release={release} fresh={fresh} />,
          };
        })}
      />
    </div>
  );
}

function ReleaseNotes({ release, fresh }: { release: PatchNoteRelease; fresh: ReadonlySet<string> }) {
  const t = useTranslations("patchNotes");
  return (
    <div className="space-y-3">
      {release.notes.map((note) => (
        <p key={note} className="text-sm text-pretty text-fg-3">
          <Inline text={note} />
        </p>
      ))}
      <ul className="space-y-3">
        {release.entries.map((entry) => {
          const isNew = fresh.has(entry.id);
          return (
            <li key={entry.id} className="flex items-start gap-3" data-fresh={isNew || undefined}>
              <span
                className={cn("mt-1.5 size-2 shrink-0 rounded-xs", isNew ? "bg-info" : "bg-surface-3")}
                aria-hidden
              />
              <p className="min-w-0 flex-1 text-sm text-pretty break-words text-fg-2">
                {isNew && <span className="sr-only">{t("new")}: </span>}
                {entry.title && <strong className="font-semibold text-fg-1">{entry.title}: </strong>}
                <Inline text={entry.text} />
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Inline({ text }: { text: string }) {
  return inlineRuns(text).map((run, i) =>
    run.bold ? (
      <strong key={i} className="font-semibold text-fg-1">
        {run.text}
      </strong>
    ) : (
      run.text
    ),
  );
}
