"use client";
import { t as translate } from "@/i18n/translate";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { AssetType } from "../domain/contracts";

export function DeleteAssetDialog({
  type,
  name,
  open,
  pending,
  onOpenChange,
  onConfirm,
}: {
  type: AssetType;
  name: string;
  open: boolean;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const label = type[0].toUpperCase() + type.slice(1);
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {translate("delete")} {label}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {translate("areYouSureYouWantToDelete")}
            {name}
            {translate("thisActionCannotBeUndone")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {translate("cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={pending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {pending ? translate("deleting") : translate("delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
