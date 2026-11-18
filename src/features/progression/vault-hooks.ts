"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { engine } from "@/features/game/store";
import type { VaultDeposits } from "@/features/game/types";

/** Festgeld in the vault (ADR-201). */
export const VAULT_DEPOSITS_KEY = ["vault-deposits"] as const;

export function useVaultDeposits(enabled = true) {
  return useQuery({
    queryKey: VAULT_DEPOSITS_KEY,
    queryFn: () => engine.vaultDeposits(),
    staleTime: 30_000,
    enabled,
  });
}

export function useSetVaultDeposits() {
  const client = useQueryClient();
  return (state: VaultDeposits) => client.setQueryData(VAULT_DEPOSITS_KEY, state);
}
