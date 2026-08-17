import type { AssetType } from "../domain/contracts";

export const assetQueryKeys = {
  all: ["assets"] as const,
  list: (type: AssetType) => ["assets", type] as const,
  owners: (type: AssetType, id: string) => ["owners", type, id] as const,
};
