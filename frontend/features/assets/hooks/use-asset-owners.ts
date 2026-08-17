"use client";
import { useQuery } from "@tanstack/react-query";
import { assetQueryKeys } from "../client/query-keys";
import { loadAssetOwners } from "../client/actions";
import type { AssetOwner, AssetPerson, AssetType } from "../domain/contracts";

export function useAssetOwners(
  type: AssetType,
  id: string | undefined,
  ownerIds: string[],
  people: AssetPerson[],
) {
  return useQuery({
    queryKey: assetQueryKeys.owners(type, id ?? "idle"),
    enabled: Boolean(id),
    queryFn: async (): Promise<AssetOwner[]> => {
      try {
        return await loadAssetOwners(type, id!);
      } catch {
        if (ownerIds.length)
          return ownerIds.map((personId) => ({ personId, share: null }));
        const self = people.find((person) => person.kind === "self");
        return self ? [{ personId: self.id, share: null }] : [];
      }
    },
  });
}
