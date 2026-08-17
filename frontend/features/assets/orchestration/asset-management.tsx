"use client";
import { t as translate } from "@/i18n/translate";


import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AddAssetDialog } from "@/components/assets/add-asset-dialog";
import { UpdateBalanceDialog } from "@/components/accounts/update-balance-dialog";
import { useRegisterCommandPaletteCallbacks } from "@/components/command-palette-context";
import { AccountAssetList, PropertyAssetList, VehicleAssetList } from "../components/asset-lists";
import { AccountEditForm } from "../components/account-edit-form";
import { PropertyEditForm } from "../components/property-edit-form";
import { VehicleEditForm } from "../components/vehicle-edit-form";
import { DeleteAssetDialog } from "../components/delete-asset-dialog";
import { useAccountAssetController } from "../hooks/use-account-asset-controller";
import { usePropertyAssetController } from "../hooks/use-property-asset-controller";
import { useVehicleAssetController } from "../hooks/use-vehicle-asset-controller";
import type { AssetDialogState, AssetManagementViewModel, AssetType } from "../domain/contracts";

const IDLE: AssetDialogState = { mode: "idle", assetType: null, assetId: null };

export function AssetManagement({ model }: { model: AssetManagementViewModel }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<AssetDialogState>(IDLE);
  const [addOpen, setAddOpen] = useState(false);
  const close = useCallback(() => setDialog(IDLE), []);
  const refresh = useCallback(() => router.refresh(), [router]);
  const open = useCallback((mode: AssetDialogState["mode"], assetType: AssetType, assetId: string) => setDialog({ mode, assetType, assetId }), []);
  const openAdd = useCallback(() => setAddOpen(true), []);
  useRegisterCommandPaletteCallbacks({ onAddAsset: openAdd }, [openAdd]);

  const account = useMemo(() => dialog.assetType === "account" ? model.accounts.find((item) => item.id === dialog.assetId) : undefined, [dialog, model.accounts]);
  const property = useMemo(() => dialog.assetType === "property" ? model.properties.find((item) => item.id === dialog.assetId) : undefined, [dialog, model.properties]);
  const vehicle = useMemo(() => dialog.assetType === "vehicle" ? model.vehicles.find((item) => item.id === dialog.assetId) : undefined, [dialog, model.vehicles]);
  const accountController = useAccountAssetController(account, model.people, close, refresh);
  const propertyController = usePropertyAssetController(property, model.people, close, refresh);
  const vehicleController = useVehicleAssetController(vehicle, model.people, close, refresh);

  const deleting = dialog.mode === "delete" ? account ?? property ?? vehicle : undefined;
  const deletePending = dialog.assetType === "account" ? accountController.pending : dialog.assetType === "property" ? propertyController.pending : vehicleController.pending;
  const confirmDelete = () => { if (dialog.assetType === "account") void accountController.remove(); else if (dialog.assetType === "property") void propertyController.remove(); else if (dialog.assetType === "vehicle") void vehicleController.remove(); };

  return <div className="space-y-6"><div className="flex items-center justify-between"><div><h2 className="text-lg font-semibold">{translate("assetManagement")}</h2><p className="text-sm text-muted-foreground">{translate("addAndManageYourAccountsPropertiesAndVehicles")}</p></div><AddAssetDialog onAssetAdded={refresh} open={addOpen} onOpenChange={setAddOpen} /></div>
    <AccountAssetList accounts={model.accounts} people={model.people} onView={(id) => router.push(`/accounts/${id}`)} onEdit={(id) => open("edit", "account", id)} onDelete={(id) => open("delete", "account", id)} onRecalculate={(id) => { const target = model.accounts.find((item) => item.id === id); if (target) void accountController.recalculate(target); }} />
    <PropertyAssetList properties={model.properties} people={model.people} onEdit={(id) => open("edit", "property", id)} onDelete={(id) => open("delete", "property", id)} />
    <VehicleAssetList vehicles={model.vehicles} people={model.people} onEdit={(id) => open("edit", "vehicle", id)} onDelete={(id) => open("delete", "vehicle", id)} />
    {dialog.mode === translate("edit9ead47") && accountController.values && <AccountEditForm key={account?.id} values={accountController.values} people={model.people} open pending={accountController.pending} logoLookupEnabled={accountController.logoLookupEnabled} onOpenChange={(isOpen) => !isOpen && close()} onSubmit={accountController.save} onLookupLogo={accountController.lookupLogo} onAdjustBalance={() => account && open("balance", "account", account.id)} />}
    {dialog.mode === translate("edit9ead47") && propertyController.values && <PropertyEditForm key={property?.id} values={propertyController.values} people={model.people} open pending={propertyController.pending} onOpenChange={(isOpen) => !isOpen && close()} onSubmit={propertyController.save} />}
    {dialog.mode === translate("edit9ead47") && vehicleController.values && <VehicleEditForm key={vehicle?.id} values={vehicleController.values} people={model.people} open pending={vehicleController.pending} onOpenChange={(isOpen) => !isOpen && close()} onSubmit={vehicleController.save} />}
    {deleting && dialog.assetType && <DeleteAssetDialog type={dialog.assetType} name={deleting.name} open pending={deletePending} onOpenChange={(isOpen) => !isOpen && close()} onConfirm={confirmDelete} />}
    {dialog.mode === translate("balance8dfa30") && account && <UpdateBalanceDialog account={{ id: account.id, name: account.name, currency: account.currency, functionalBalance: account.balance }} open onOpenChange={(isOpen) => !isOpen && close()} onSuccess={() => { close(); refresh(); }} />}
  </div>;
}
