"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { deleteAsset, persistAssetOwners, updatePropertyAsset } from "../client/actions";
import { assetQueryKeys } from "../client/query-keys";
import { useAssetOwners } from "./use-asset-owners";
import type { AssetPerson, PropertyAssetViewModel, PropertyEditValues } from "../domain/contracts";

export function usePropertyAssetController(property: PropertyAssetViewModel | undefined, people: AssetPerson[], onFinished: () => void, refresh: () => void) {
  const queryClient = useQueryClient(); const owners = useAssetOwners("property", property?.id, property?.ownerIds ?? [], people);
  const save = useMutation({ mutationFn: async (values: PropertyEditValues) => { const result = await updatePropertyAsset(property!.id, values); if (!result.success) throw new Error(result.error || "Failed to update property"); await persistAssetOwners("property", property!.id, values.owners); }, onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: assetQueryKeys.all }); toast.success("Property updated"); onFinished(); refresh(); }, onError: (error) => toast.error(error.message || "An error occurred") });
  const remove = useMutation({ mutationFn: async () => { const result = await deleteAsset.property(property!.id); if (!result.success) throw new Error(result.error || "Failed to delete property"); }, onSuccess: () => { toast.success("Property deleted"); onFinished(); refresh(); }, onError: (error) => toast.error(error.message || "An error occurred") });
  const values: PropertyEditValues | undefined = property && owners.data ? { name: property.name, propertyType: property.propertyType, address: property.address ?? "", currentValue: property.value, currency: property.currency, owners: owners.data } : undefined;
  return { values, save: save.mutateAsync, remove: remove.mutateAsync, pending: save.isPending || remove.isPending };
}
