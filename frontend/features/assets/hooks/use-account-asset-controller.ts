"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { deleteAsset, isLogoLookupEnabled, lookupAccountLogo, persistAssetOwners, recalculateAccount, updateAccountAsset } from "../client/actions";
import { assetQueryKeys } from "../client/query-keys";
import { useAssetOwners } from "./use-asset-owners";
import type { AccountAssetViewModel, AccountEditValues, AssetLogo, AssetPerson } from "../domain/contracts";

export function useAccountAssetController(account: AccountAssetViewModel | undefined, people: AssetPerson[], onFinished: () => void, refresh: () => void) {
  const queryClient = useQueryClient();
  const owners = useAssetOwners("account", account?.id, account?.ownerIds ?? [], people);
  const logoEnabled = useQuery({ queryKey: ["assets", "logo-lookup-enabled"], queryFn: isLogoLookupEnabled, staleTime: Infinity });
  const invalidate = async (id: string) => { await Promise.all([queryClient.invalidateQueries({ queryKey: assetQueryKeys.all }), queryClient.invalidateQueries({ queryKey: assetQueryKeys.owners("account", id) })]); };
  const save = useMutation({ mutationFn: async (values: AccountEditValues) => { const result = await updateAccountAsset(account!.id, values); if (!result.success) throw new Error(result.error || "Failed to update account"); await persistAssetOwners("account", account!.id, values.owners); }, onSuccess: async () => { await invalidate(account!.id); toast.success("Account updated"); onFinished(); refresh(); }, onError: (error) => toast.error(error.message || "An error occurred") });
  const remove = useMutation({ mutationFn: async () => { const result = await deleteAsset.account(account!.id); if (!result.success) throw new Error(result.error || "Failed to delete account"); }, onSuccess: () => { toast.success("Account deleted"); onFinished(); refresh(); }, onError: (error) => toast.error(error.message || "An error occurred") });
  const recalculate = async (target: AccountAssetViewModel) => { toast.loading(`Recalculating balance for ${target.name}...`, { id: "recalculate" }); try { const result = await recalculateAccount(target.id); if (!result.success) throw new Error(result.error || "Failed to recalculate balance"); toast.success(`Balance recalculated for ${target.name}. Processed ${result.daysProcessed || 0} days.`, { id: "recalculate" }); refresh(); } catch (error) { toast.error(error instanceof Error ? error.message : "An error occurred", { id: "recalculate" }); } };
  const lookupLogo = async (query: string): Promise<AssetLogo | null> => { if (!query.trim()) return null; try { const result = await lookupAccountLogo(query.trim()); if (!result.success) throw new Error(result.error || "Failed to search for logo"); if (!result.logo) { toast.info("No logo found for this institution"); return null; } toast.success("Logo found"); return result.logo; } catch (error) { toast.error(error instanceof Error ? error.message : "Failed to search for logo"); return null; } };
  const values: AccountEditValues | undefined = account && owners.data ? { name: account.name, accountType: account.accountType, institution: account.institution ?? "", currency: account.currency, balance: account.balance, logoId: account.logo?.id ?? null, logoUrl: account.logo?.logoUrl ?? null, logoUpdatedAt: account.logo?.updatedAt ?? null, owners: owners.data } : undefined;
  return { values, logoLookupEnabled: logoEnabled.data ?? false, save: save.mutateAsync, remove: remove.mutateAsync, recalculate, lookupLogo, pending: save.isPending || remove.isPending };
}
