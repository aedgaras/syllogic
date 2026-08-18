"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { getUserAccounts } from "@/lib/actions/transactions";
import { getUserCategories } from "@/lib/actions/categories";
import { filterCategoriesByType } from "@/lib/utils/category-utils";
import type { CategoryDisplay } from "@/shared/domain/display-contracts";
import { confirmReceiptScan, uploadAndExtractReceipt } from "../server/actions";
import type { ReceiptLineItem, ReceiptScanAccount } from "../domain/contracts";

type Step = "upload" | "reviewing";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

let itemKeyCounter = 0;
function nextItemKey(): string {
  itemKeyCounter += 1;
  return `item-${itemKeyCounter}`;
}

export function useReceiptScanController() {
  const router = useRouter();

  const [accounts, setAccounts] = useState<ReceiptScanAccount[]>([]);
  const [categories, setCategories] = useState<CategoryDisplay[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");

  const [step, setStep] = useState<Step>("upload");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [receiptScanId, setReceiptScanId] = useState<string | null>(null);
  const [merchantName, setMerchantName] = useState<string | null>(null);
  const [receiptTotal, setReceiptTotal] = useState<string | null>(null);
  const [items, setItems] = useState<ReceiptLineItem[]>([]);

  useEffect(() => {
    void getUserAccounts().then((data) => {
      setAccounts(data);
      if (data[0]) setSelectedAccountId(data[0].id);
    });
    void getUserCategories().then((data) => {
      setCategories(filterCategoriesByType(data, "expense"));
    });
  }, []);

  const selectFile = (file: File) => {
    setSelectedFile(file);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
  };

  const clearFile = () => {
    setSelectedFile(null);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  };

  const extract = async () => {
    if (!selectedAccountId) {
      toast.error("Please select an account");
      return;
    }
    if (!selectedFile) {
      toast.error("Please upload a receipt photo");
      return;
    }
    setIsUploading(true);
    try {
      const base64 = await fileToBase64(selectedFile);
      const result = await uploadAndExtractReceipt(
        selectedAccountId,
        base64,
        selectedFile.type || "image/jpeg",
      );
      if (result.success && result.result) {
        setReceiptScanId(result.result.receiptScanId);
        setMerchantName(result.result.merchantName);
        setReceiptTotal(result.result.receiptTotal);
        setItems(
          result.result.items.length > 0
            ? result.result.items.map((item) => ({
                ...item,
                key: nextItemKey(),
              }))
            : [
                {
                  key: nextItemKey(),
                  description: "",
                  amount: "",
                  categoryId: null,
                  categoryName: null,
                  transactionType: "debit",
                },
              ],
        );
        setStep("reviewing");
      } else {
        toast.error(result.error ?? "Failed to process receipt");
      }
    } catch {
      toast.error("An error occurred. Please try again.");
    } finally {
      setIsUploading(false);
    }
  };

  const updateItem = (key: string, patch: Partial<ReceiptLineItem>) => {
    setItems((prev) =>
      prev.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    );
  };

  const removeItem = (key: string) => {
    setItems((prev) => prev.filter((item) => item.key !== key));
  };

  const splitItem = (key: string) => {
    setItems((prev) => {
      const index = prev.findIndex((item) => item.key === key);
      if (index === -1) return prev;
      const original = prev[index];
      const originalAmount = Number(original.amount) || 0;
      const half = (originalAmount / 2).toFixed(2);
      const remainder = (originalAmount - Number(half)).toFixed(2);
      const updated: ReceiptLineItem = { ...original, amount: half };
      const split: ReceiptLineItem = {
        ...original,
        key: nextItemKey(),
        amount: remainder,
      };
      const next = [...prev];
      next.splice(index, 1, updated, split);
      return next;
    });
  };

  const addBlankItem = () => {
    setItems((prev) => [
      ...prev,
      {
        key: nextItemKey(),
        description: "",
        amount: "",
        categoryId: null,
        categoryName: null,
        transactionType: "debit",
      },
    ]);
  };

  const itemsTotal = items.reduce(
    (sum, item) => sum + (Number(item.amount) || 0),
    0,
  );

  const confirm = async () => {
    if (!receiptScanId) return;
    const validItems = items.filter(
      (item) => item.description.trim() && Number(item.amount) > 0,
    );
    if (validItems.length === 0) {
      toast.error("Add at least one item with a description and amount");
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await confirmReceiptScan(
        receiptScanId,
        validItems,
        new Date().toISOString(),
      );
      if (result.success) {
        toast.success(
          `Created ${result.transactionCount ?? validItems.length} transaction(s)`,
        );
        router.push("/transactions");
      } else {
        toast.error(result.error ?? "Failed to save transactions");
      }
    } catch {
      toast.error("An error occurred. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const goBack = () => {
    if (step === "reviewing") {
      setStep("upload");
      return;
    }
    router.push("/transactions");
  };

  return {
    accounts,
    categories,
    selectedAccountId,
    setSelectedAccountId,
    step,
    selectedFile,
    previewUrl,
    isUploading,
    isSubmitting,
    selectFile,
    clearFile,
    extract,
    merchantName,
    receiptTotal,
    items,
    itemsTotal,
    updateItem,
    removeItem,
    splitItem,
    addBlankItem,
    confirm,
    goBack,
  };
}
