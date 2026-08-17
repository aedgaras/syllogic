import { getAccounts } from "@/features/accounts/server";
import { getProperties } from "@/lib/actions/properties";
import { getVehicles } from "@/lib/actions/vehicles";
import { getPeople, getOwnersForEntities } from "@/lib/people";
import { avatarUrl } from "@/lib/people/avatars";
import { requireAuth } from "@/lib/auth-helpers";
import { AssetManagement } from "@/features/assets/public";
import {
  toAccountAssetViewModel,
  toPropertyAssetViewModel,
  toVehicleAssetViewModel,
} from "@/features/assets/server";

function ownerIdsByEntity(
  map: Map<string, { personId: string }[]>
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [id, owners] of map) {
    out[id] = owners.map((o) => o.personId);
  }
  return out;
}

export async function AssetsSection() {
  const userId = await requireAuth();

  const [accounts, properties, vehicles, peopleRows] = await Promise.all([
    getAccounts(),
    getProperties(),
    getVehicles(),
    userId ? getPeople(userId) : Promise.resolve([]),
  ]);

  // Batch-fetch owners for all visible entities in parallel — avoids N waterfall
  // requests from <OwnerBadges> on each row.
  const [accountOwnersMap, propertyOwnersMap, vehicleOwnersMap] =
    await Promise.all([
      getOwnersForEntities("account", accounts.map((a) => a.id)),
      getOwnersForEntities("property", properties.map((p) => p.id)),
      getOwnersForEntities("vehicle", vehicles.map((v) => v.id)),
    ]);

  const people = peopleRows.map((p) => ({
    id: p.id,
    name: p.name,
    kind: p.kind,
    color: p.color,
    avatarUrl: avatarUrl(p.avatarPath),
  }));

  const accountOwnerIds = ownerIdsByEntity(accountOwnersMap);
  const propertyOwnerIds = ownerIdsByEntity(propertyOwnersMap);
  const vehicleOwnerIds = ownerIdsByEntity(vehicleOwnersMap);

  return <AssetManagement model={{
    accounts: accounts.map((account) => toAccountAssetViewModel(account, accountOwnerIds[account.id])),
    properties: properties.map((property) => toPropertyAssetViewModel(property, propertyOwnerIds[property.id])),
    vehicles: vehicles.map((vehicle) => toVehicleAssetViewModel(vehicle, vehicleOwnerIds[vehicle.id])),
    people,
  }} />;
}
