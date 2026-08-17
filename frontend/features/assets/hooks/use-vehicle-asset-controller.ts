"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { deleteAsset, persistAssetOwners, updateVehicleAsset } from "../client/actions";
import { assetQueryKeys } from "../client/query-keys";
import { useAssetOwners } from "./use-asset-owners";
import type { AssetPerson, VehicleAssetViewModel, VehicleEditValues } from "../domain/contracts";

export function useVehicleAssetController(vehicle: VehicleAssetViewModel | undefined, people: AssetPerson[], onFinished: () => void, refresh: () => void) {
  const queryClient = useQueryClient(); const owners = useAssetOwners("vehicle", vehicle?.id, vehicle?.ownerIds ?? [], people);
  const save = useMutation({ mutationFn: async (values: VehicleEditValues) => { const result = await updateVehicleAsset(vehicle!.id, values); if (!result.success) throw new Error(result.error || "Failed to update vehicle"); await persistAssetOwners("vehicle", vehicle!.id, values.owners); }, onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: assetQueryKeys.all }); toast.success("Vehicle updated"); onFinished(); refresh(); }, onError: (error) => toast.error(error.message || "An error occurred") });
  const remove = useMutation({ mutationFn: async () => { const result = await deleteAsset.vehicle(vehicle!.id); if (!result.success) throw new Error(result.error || "Failed to delete vehicle"); }, onSuccess: () => { toast.success("Vehicle deleted"); onFinished(); refresh(); }, onError: (error) => toast.error(error.message || "An error occurred") });
  const values: VehicleEditValues | undefined = vehicle && owners.data ? { name: vehicle.name, vehicleType: vehicle.vehicleType, make: vehicle.make ?? "", model: vehicle.model ?? "", year: vehicle.year?.toString() ?? "", currentValue: vehicle.value, currency: vehicle.currency, owners: owners.data } : undefined;
  return { values, save: save.mutateAsync, remove: remove.mutateAsync, pending: save.isPending || remove.isPending };
}
