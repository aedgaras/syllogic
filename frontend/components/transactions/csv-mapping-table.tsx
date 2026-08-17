"use client";
import { t as translate } from "@/i18n/translate";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { ColumnMapping } from "@/features/csv-import/public";
import { DATE_FORMAT_OPTIONS, type ImportDateFormat } from "@/lib/import/dates";

interface CsvMappingTableProps {
  headers: string[];
  mapping: ColumnMapping;
  onMappingChange: (mapping: ColumnMapping) => void;
}

const FIELD_MAPPINGS = [
  {
    key: "date",
    label: translate("date"),
    description: translate("transactionDate"),
    required: true,
  },
  {
    key: "amount",
    label: translate("amount"),
    description: translate("transactionAmount"),
    required: true,
  },
  {
    key: "description",
    label: translate("description55f8eb"),
    description: translate("transactionDescription"),
    required: true,
  },
  {
    key: "fee",
    label: translate("fee"),
    description: translate("transactionFeeDeductedFromBalance"),
    required: false,
  },
  {
    key: "state",
    label: translate("stateStatus"),
    description: translate("transactionStatusEGCompletedPending"),
    required: false,
  },
  {
    key: "startingBalance",
    label: translate("startingBalance"),
    description: translate("openingBalanceForVerification"),
    required: false,
  },
  {
    key: "endingBalance",
    label: translate("endingBalance"),
    description: translate("closingBalanceForVerification"),
    required: false,
  },
] as const;

export function CsvMappingTable({
  headers,
  mapping,
  onMappingChange,
}: CsvMappingTableProps) {
  const updateMapping = (field: keyof ColumnMapping, value: string | null) => {
    onMappingChange({
      ...mapping,
      [field]: value === "none" ? null : value,
    });
  };

  const updateTypeConfig = (key: string, value: string | boolean | null) => {
    onMappingChange({
      ...mapping,
      typeConfig: {
        ...mapping.typeConfig,
        [key]: value,
      },
    });
  };

  return (
    <div className="space-y-6">
      {/* Field Mappings as List */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-muted-foreground">
          {translate("columnMappings")}
        </h3>
        <div className="space-y-3">
          {FIELD_MAPPINGS.map((field) => (
            <div
              key={field.key}
              className="flex items-center justify-between gap-4 rounded-lg border bg-card p-4"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <Label className="font-medium">
                    {field.label}
                    {field.required && (
                      <span className="ml-1 text-destructive">*</span>
                    )}
                  </Label>
                </div>
                <p className="text-xs text-muted-foreground">
                  {field.description}
                </p>
              </div>
              <Select
                value={
                  (mapping[field.key as keyof ColumnMapping] as string) ||
                  "none"
                }
                onValueChange={(value) =>
                  updateMapping(field.key as keyof ColumnMapping, value)
                }
              >
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder={translate("selectColumn")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{translate("notMapped")}</SelectItem>
                  {headers.map((header) => (
                    <SelectItem key={header} value={header}>
                      {header}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      </div>

      {/* Configuration Options */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted-foreground">
          {translate("options")}
        </h3>

        {/* Amount Sign Configuration */}
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center space-x-3">
            <Checkbox
              id="isAmountSigned"
              checked={mapping.typeConfig?.isAmountSigned ?? false}
              onCheckedChange={(checked) =>
                updateTypeConfig("isAmountSigned", !!checked)
              }
            />
            <div>
              <Label htmlFor="isAmountSigned" className="font-medium">
                {translate("amountIsSigned")}
              </Label>
              <p className="text-xs text-muted-foreground">
                {translate("positiveValuesIncomeNegativeValuesExpense")}
              </p>
            </div>
          </div>
        </div>

        {/* Date Format Configuration */}
        <div className="rounded-lg border bg-card p-4">
          <div className="space-y-3">
            <div>
              <Label className="font-medium">{translate("dateFormat")}</Label>
              <p className="text-xs text-muted-foreground">
                {translate("forAmbiguousDatesEG01022025Specify")}
              </p>
            </div>
            <Select
              value={mapping.typeConfig?.dateFormat ?? "DD-MM-YYYY"}
              onValueChange={(value) =>
                updateTypeConfig("dateFormat", value as ImportDateFormat)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder={translate("selectDateFormat")} />
              </SelectTrigger>
              <SelectContent>
                {DATE_FORMAT_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label} {translate("eG")} {option.example})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="rounded-lg border bg-card p-4">
          <div className="space-y-3">
            <div>
              <Label className="font-medium">{translate("amountFormat")}</Label>
              <p className="text-xs text-muted-foreground">
                {translate(
                  "controlsDecimalSeparatorsForAmountsFeesAndBalanceColumns",
                )}
              </p>
            </div>
            <Select
              value={mapping.typeConfig?.amountFormat ?? "AUTO"}
              onValueChange={(value) => updateTypeConfig("amountFormat", value)}
            >
              <SelectTrigger>
                <SelectValue placeholder={translate("selectAmountFormat")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="AUTO">{translate("autoDetect")}</SelectItem>
                <SelectItem value="DOT_DECIMAL">1,234.56</SelectItem>
                <SelectItem value="COMMA_DECIMAL">1.234,56</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Completed State Value Configuration - only shown when State column is mapped */}
        {mapping.state && (
          <div className="rounded-lg border bg-card p-4">
            <div className="space-y-3">
              <div>
                <Label className="font-medium">
                  {translate("completedStateValue")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {translate(
                    "valueThatIndicatesACompletedTransactionEGCompleted",
                  )}
                </p>
              </div>
              <Input
                placeholder={translate("eGCompleted")}
                value={mapping.typeConfig?.completedStateValue ?? ""}
                onChange={(e) =>
                  updateTypeConfig("completedStateValue", e.target.value)
                }
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
