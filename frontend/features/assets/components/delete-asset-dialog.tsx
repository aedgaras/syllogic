"use client";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import type { AssetType } from "../domain/contracts";

export function DeleteAssetDialog({ type, name, open, pending, onOpenChange, onConfirm }: { type: AssetType; name: string; open: boolean; pending: boolean; onOpenChange: (open: boolean) => void; onConfirm: () => void }) {
  const label = type[0].toUpperCase() + type.slice(1);
  return <AlertDialog open={open} onOpenChange={onOpenChange}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete {label}</AlertDialogTitle><AlertDialogDescription>Are you sure you want to delete &quot;{name}&quot;? This action cannot be undone.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel><AlertDialogAction onClick={onConfirm} disabled={pending} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{pending ? "Deleting..." : "Delete"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>;
}
