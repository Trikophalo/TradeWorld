"use client";

import { create } from "zustand";

/** Open state of the global search, shared by the top bar and the "/" shortcut. */
export const useSearch = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
