"use client";
import { t as translate } from "@/i18n/translate";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { OwnersField } from "@/components/household/owners-field";
import { CURRENCIES } from "@/lib/constants/currencies";
import { VEHICLE_TYPES } from "@/components/assets/types";
import { vehicleEditSchema } from "../domain/edit-schemas";
import type { AssetPerson, VehicleEditValues } from "../domain/contracts";

export function VehicleEditForm({ values, people, open, pending, onOpenChange, onSubmit }: { values: VehicleEditValues; people: AssetPerson[]; open: boolean; pending: boolean; onOpenChange: (open: boolean) => void; onSubmit: (values: VehicleEditValues) => Promise<void> }) {
  const { control, register, handleSubmit, formState: { errors } } = useForm<VehicleEditValues>({ resolver: zodResolver(vehicleEditSchema), defaultValues: values });
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-[425px]"><DialogHeader><DialogTitle>{translate("editVehicle")}</DialogTitle><DialogDescription>{translate("updateYourVehicleDetails")}</DialogDescription></DialogHeader><form onSubmit={handleSubmit(onSubmit)}><div className="grid gap-4 py-4">
    <Field label={translate("vehicleName")} error={errors.name?.message}><Input aria-label={translate("vehicleName")} {...register("name")} /></Field><Controller control={control} name="vehicleType" render={({ field }) => <Field label={translate("vehicleType")}><Select value={field.value} onValueChange={field.onChange}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{VEHICLE_TYPES.map((type) => <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>)}</SelectContent></Select></Field>} />
    <div className="grid grid-cols-2 gap-4"><Field label={translate("makeOptional")}><Input aria-label={translate("makeOptional")} {...register("make")} /></Field><Field label={translate("modelOptional")}><Input aria-label={translate("modelOptional")} {...register("model")} /></Field></div><Field label={translate("yearOptional")} error={errors.year?.message}><Input aria-label={translate("yearOptional")} type="number" {...register("year")} /></Field><Field label={translate("currentValue")} error={errors.currentValue?.message}><Input aria-label={translate("currentValue")} type="number" step="0.01" {...register("currentValue")} /></Field>
    <Controller control={control} name="currency" render={({ field }) => <Field label={translate("currency")}><Select value={field.value} onValueChange={field.onChange}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CURRENCIES.map((currency) => <SelectItem key={currency.code} value={currency.code}>{currency.code} - {currency.name}</SelectItem>)}</SelectContent></Select></Field>} />{people.length > 1 && <Controller control={control} name="owners" render={({ field }) => <OwnersField people={people} value={field.value} onChange={field.onChange} disabled={pending} />} />}{errors.owners?.message && <p className="text-sm text-destructive">{errors.owners.message}</p>}
  </div><DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>{translate("cancel")}</Button><Button type="submit" disabled={pending}>{pending ? translate("saving") : translate("saveChangesfa2984")}</Button></DialogFooter></form></DialogContent></Dialog>;
}
function Field({ label, error, children }: React.PropsWithChildren<{ label: string; error?: string }>) { return <div className="space-y-2"><Label>{label}</Label>{children}{error && <p className="text-sm text-destructive">{error}</p>}</div>; }
