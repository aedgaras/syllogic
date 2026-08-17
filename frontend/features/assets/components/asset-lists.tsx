"use client";
import { t as translate } from "@/i18n/translate";


import { RiCalculatorLine, RiCarLine, RiDeleteBinLine, RiEditLine, RiEyeLine, RiHome4Line, RiMoreLine } from "@remixicon/react";
import { AccountLogo } from "@/components/ui/account-logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { OwnerBadges } from "@/components/household/owner-badges";
import { PROPERTY_TYPES, VEHICLE_TYPES } from "@/components/assets/types";
import type { AccountAssetViewModel, AssetPerson, PropertyAssetViewModel, VehicleAssetViewModel } from "../domain/contracts";

const ACCOUNT_TYPES = [
  { value: "checking", label: translate("checkingAccount") }, { value: "savings", label: translate("savingsAccount") },
  { value: "credit_card", label: translate("creditCard") }, { value: "investment", label: translate("investmentAccount") },
  { value: "cash", label: translate("cash") }, { value: "other", label: translate("other") },
] as const;

const labelFor = (items: readonly { value: string; label: string }[], value: string) => items.find((item) => item.value === value)?.label ?? value;
const formatCurrency = (value: string, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(value) || 0);

function Empty({ children }: React.PropsWithChildren) {
  return <div className="flex h-24 items-center justify-center rounded border border-dashed"><p className="text-sm text-muted-foreground">{children}</p></div>;
}

export function AccountAssetList({ accounts, people, onView, onEdit, onDelete, onRecalculate }: {
  accounts: AccountAssetViewModel[]; people: AssetPerson[];
  onView: (id: string) => void; onEdit: (id: string) => void; onDelete: (id: string) => void; onRecalculate: (id: string) => void;
}) {
  return <Card data-walkthrough="walkthrough-accounts"><CardHeader><CardTitle>{translate("accounts")}</CardTitle><CardDescription>{translate("yourFinancialAccountsAndCashHoldings")}</CardDescription></CardHeader><CardContent>
    {accounts.length === 0 ? <Empty>{translate("noAccountsAdded")}</Empty> : <div className="divide-y">{accounts.map((account) => <div key={account.id} className="flex items-center justify-between py-4 first:pt-0 last:pb-0">
      <div className="flex items-center gap-3"><AccountLogo name={account.name} logoUrl={account.logo?.logoUrl} updatedAt={account.logo?.updatedAt} className="!size-10" /><div><div className="flex items-center gap-2"><p className="font-medium">{account.name}</p><OwnerBadges entityType="account" entityId={account.id} size={20} people={people} ownerIds={account.ownerIds} /></div><p className="text-sm text-muted-foreground">{labelFor(ACCOUNT_TYPES, account.accountType)}{account.institution && translate("message2d7039", { value1: account.institution })}</p></div></div>
      <div className="flex items-center gap-4"><div className="text-right"><p className="font-medium">{formatCurrency(account.balance, account.currency)}</p><p className="text-xs text-muted-foreground">{account.currency}</p></div><Button className="cursor-pointer" onClick={() => onView(account.id)}><RiEyeLine className="h-5 w-5" />{translate("view69bd4e")}</Button><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="sm"><RiMoreLine className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => onEdit(account.id)}><RiEditLine className="mr-2 h-4 w-4" />{translate("edit")}</DropdownMenuItem><DropdownMenuItem onClick={() => onRecalculate(account.id)}><RiCalculatorLine className="mr-2 h-4 w-4" />{translate("recalculateBalance")}</DropdownMenuItem><DropdownMenuItem className="text-destructive" onClick={() => onDelete(account.id)}><RiDeleteBinLine className="mr-2 h-4 w-4" />{translate("delete")}</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>
    </div>)}</div>}
  </CardContent></Card>;
}

export function PropertyAssetList({ properties, people, onEdit, onDelete }: { properties: PropertyAssetViewModel[]; people: AssetPerson[]; onEdit: (id: string) => void; onDelete: (id: string) => void }) {
  return <Card><CardHeader><CardTitle>{translate("properties")}</CardTitle><CardDescription>{translate("yourRealEstateHoldings")}</CardDescription></CardHeader><CardContent>{properties.length === 0 ? <Empty>{translate("noPropertiesAdded")}</Empty> : <div className="divide-y">{properties.map((property) => <div key={property.id} className="flex items-center justify-between py-4 first:pt-0 last:pb-0"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded bg-muted"><RiHome4Line className="h-5 w-5 text-muted-foreground" /></div><div><div className="flex items-center gap-2"><p className="font-medium">{property.name}</p><OwnerBadges entityType="property" entityId={property.id} size={20} people={people} ownerIds={property.ownerIds} /></div><p className="text-sm text-muted-foreground">{labelFor(PROPERTY_TYPES, property.propertyType)}{property.address && translate("message2d7039", { value1: property.address })}</p></div></div><AssetRowActions value={formatCurrency(property.value, property.currency)} currency={property.currency} onEdit={() => onEdit(property.id)} onDelete={() => onDelete(property.id)} /></div>)}</div>}</CardContent></Card>;
}

export function VehicleAssetList({ vehicles, people, onEdit, onDelete }: { vehicles: VehicleAssetViewModel[]; people: AssetPerson[]; onEdit: (id: string) => void; onDelete: (id: string) => void }) {
  return <Card data-walkthrough="walkthrough-vehicles"><CardHeader><CardTitle>{translate("vehicles")}</CardTitle><CardDescription>{translate("yourVehiclesAndTransportationAssets")}</CardDescription></CardHeader><CardContent>{vehicles.length === 0 ? <Empty>{translate("noVehiclesAdded")}</Empty> : <div className="divide-y">{vehicles.map((vehicle) => <div key={vehicle.id} className="flex items-center justify-between py-4 first:pt-0 last:pb-0"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded bg-muted"><RiCarLine className="h-5 w-5 text-muted-foreground" /></div><div><div className="flex items-center gap-2"><p className="font-medium">{vehicle.name}</p><OwnerBadges entityType="vehicle" entityId={vehicle.id} size={20} people={people} ownerIds={vehicle.ownerIds} /></div><p className="text-sm text-muted-foreground">{labelFor(VEHICLE_TYPES, vehicle.vehicleType)}{vehicle.make && translate("message2d7039", { value1: vehicle.make })}{vehicle.model && translate("messagede3545", { value1: vehicle.model })}{vehicle.year && translate("messagecd176d", { value1: vehicle.year })}</p></div></div><AssetRowActions value={formatCurrency(vehicle.value, vehicle.currency)} currency={vehicle.currency} onEdit={() => onEdit(vehicle.id)} onDelete={() => onDelete(vehicle.id)} /></div>)}</div>}</CardContent></Card>;
}

function AssetRowActions({ value, currency, onEdit, onDelete }: { value: string; currency: string; onEdit: () => void; onDelete: () => void }) {
  return <div className="flex items-center gap-4"><div className="text-right"><p className="font-medium">{value}</p><p className="text-xs text-muted-foreground">{currency}</p></div><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="sm"><RiMoreLine className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={onEdit}><RiEditLine className="mr-2 h-4 w-4" />{translate("edit")}</DropdownMenuItem><DropdownMenuItem className="text-destructive" onClick={onDelete}><RiDeleteBinLine className="mr-2 h-4 w-4" />{translate("delete")}</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>;
}
