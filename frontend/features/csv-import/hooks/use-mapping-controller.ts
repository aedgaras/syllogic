"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  getAiColumnMapping,
  getCsvImportSession,
  parseCsvHeaders,
  saveColumnMapping,
} from "@/lib/actions/csv-import";
import type {
  ColumnMapping,
  ImportContext,
  ParsedCsvData,
} from "../domain/contracts";
import { getImportContextPolicy } from "../orchestration/import-context";

const emptyMapping: ColumnMapping = {
  date: null,
  amount: null,
  description: null,
  merchant: null,
  transactionType: null,
  fee: null,
  state: null,
  startingBalance: null,
  endingBalance: null,
  typeConfig: {
    isAmountSigned: true,
    amountFormat: "AUTO",
    dateFormat: "DD-MM-YYYY",
  },
};

export function useMappingController(context: ImportContext) {
  const router = useRouter();
  const importId = useSearchParams().get("id");
  const policy = getImportContextPolicy(context);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isAiMapping, setIsAiMapping] = useState(false);
  const [csvData, setCsvData] = useState<ParsedCsvData | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>(emptyMapping);
  const aiTriggered = useRef(false);

  const triggerAiMapping = useCallback(
    async (id: string, data: ParsedCsvData) => {
      if (aiTriggered.current) return;
      aiTriggered.current = true;
      setIsAiMapping(true);
      try {
        const result = await getAiColumnMapping(
          id,
          data.headers,
          data.sampleRows,
        );
        if (result.success && result.mapping) {
          setMapping(policy.sanitizeMapping(result.mapping));
          toast.success("AI mapping applied automatically");
        }
      } catch {
        toast.error("AI mapping failed. Please map columns manually.");
      } finally {
        setIsAiMapping(false);
      }
    },
    [policy],
  );

  useEffect(() => {
    const load = async () => {
      if (!importId) {
        toast.error("Import ID not found");
        router.push(policy.rootPath);
        return;
      }
      try {
        const session = await getCsvImportSession(importId);
        if (!session) {
          toast.error("Import session not found");
          router.push(policy.rootPath);
          return;
        }
        const hasMapping = Boolean(
          session.columnMapping &&
          (session.columnMapping.date ||
            session.columnMapping.amount ||
            session.columnMapping.description),
        );
        if (hasMapping) {
          setMapping(policy.sanitizeMapping(session.columnMapping!));
          aiTriggered.current = true;
        }
        const result = await parseCsvHeaders(importId);
        if (!result.success || !result.data) {
          toast.error(result.error || "Failed to parse CSV");
          router.push(policy.rootPath);
          return;
        }
        setCsvData(result.data);
        if (!hasMapping) void triggerAiMapping(importId, result.data);
      } catch {
        toast.error("Failed to load import data");
        router.push(policy.rootPath);
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, [importId, policy, router, triggerAiMapping]);

  const continueToPreview = async () => {
    if (!importId) return;
    if (!mapping.date || !mapping.amount || !mapping.description) {
      toast.error("Please map all required fields");
      return;
    }
    setIsSaving(true);
    try {
      const result = await saveColumnMapping(
        importId,
        policy.sanitizeMapping(mapping),
      );
      if (result.success) router.push(policy.previewPath(importId));
      else toast.error(result.error || "Failed to save mapping");
    } catch {
      toast.error("Failed to save mapping");
    } finally {
      setIsSaving(false);
    }
  };

  return {
    importId,
    isLoading,
    isSaving,
    isAiMapping,
    csvData,
    mapping,
    setMapping,
    continueToPreview,
    goBack: () => router.push(policy.rootPath),
  };
}
