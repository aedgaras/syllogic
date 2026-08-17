"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SubscriptionsGroupedList } from "./subscriptions-grouped-list";
import { SubscriptionFormDialog } from "./subscription-form-dialog";
import { SubscriptionDetailSheet } from "./subscription-detail-sheet";
import { withAssetVersion } from "@/lib/utils/asset-url";
import type {
  SubscriptionKpis,
  SubscriptionListRow,
  SubscriptionSuggestionViewModel,
  SubscriptionViewModel,
} from "@/features/subscriptions/public";
import { useSubscriptionListController } from "@/features/subscriptions/hooks/use-subscription-list-controller";

// Extended type for table rows that can be either a subscription or a suggestion
export type SubscriptionOrSuggestion = SubscriptionListRow;

interface SubscriptionsClientProps {
  initialSubscriptions: SubscriptionViewModel[];
  accounts: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string; color: string | null }>;
  suggestions?: SubscriptionSuggestionViewModel[];
  kpis: SubscriptionKpis;
}

export function SubscriptionsClient({
  initialSubscriptions,
  accounts,
  categories,
  suggestions: initialSuggestions = [],
  kpis,
}: SubscriptionsClientProps) {
  const router = useRouter();
  const { subscriptions, suggestions, dismiss, remove, toggle, upsert } =
    useSubscriptionListController(initialSubscriptions, initialSuggestions);
  const [formDialogOpen, setFormDialogOpen] = useState(false);
  const [editingSubscription, setEditingSubscription] =
    useState<SubscriptionViewModel | null>(null);
  const [verifyingSuggestion, setVerifyingSuggestion] =
    useState<SubscriptionSuggestionViewModel | null>(null);
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);
  const [selectedSubscription, setSelectedSubscription] =
    useState<SubscriptionViewModel | null>(null);

  // Combine subscriptions and suggestions for table display
  // Order: Active subscriptions first, then suggestions, then inactive subscriptions
  const activeSubscriptions = subscriptions
    .filter((s) => s.isActive)
    .map((s) => ({
      ...s,
      isSuggestion: false,
      logoUrl: withAssetVersion(s.logo?.logoUrl, s.logo?.updatedAt),
    }));

  const inactiveSubscriptions = subscriptions
    .filter((s) => !s.isActive)
    .map((s) => ({
      ...s,
      isSuggestion: false,
      logoUrl: withAssetVersion(s.logo?.logoUrl, s.logo?.updatedAt),
    }));

  const suggestionRows = suggestions.map((s) => ({
    id: s.id,
    name: s.suggestedName,
    amount: s.suggestedAmount,
    currency: s.currency,
    frequency: s.detectedFrequency,
    isActive: null, // Suggestions don't have active status
    isSuggestion: true,
    confidence: s.confidence,
    matchCount: s.matchCount,
    accountName: null,
    category: null,
  }));

  const tableData: SubscriptionOrSuggestion[] = [
    // Active subscriptions first
    ...activeSubscriptions,
    // Then suggestions
    ...suggestionRows,
    // Then inactive subscriptions
    ...inactiveSubscriptions,
  ];

  const handleAdd = () => {
    setEditingSubscription(null);
    setVerifyingSuggestion(null);
    setFormDialogOpen(true);
  };

  const handleEdit = (subscription: SubscriptionViewModel) => {
    setEditingSubscription(subscription);
    setVerifyingSuggestion(null);
    setFormDialogOpen(true);
  };

  const handleVerify = (row: SubscriptionOrSuggestion) => {
    // Find the suggestion to get full data
    const suggestion = suggestions.find((s) => s.id === row.id);
    if (suggestion) {
      setVerifyingSuggestion(suggestion);
      setEditingSubscription(null);
      setFormDialogOpen(true);
    }
  };

  const handleDismiss = async (row: SubscriptionOrSuggestion) => {
    await dismiss(row.id);
  };

  const handleDelete = async (subscription: SubscriptionViewModel) => {
    await remove(subscription);
  };

  const handleToggleActive = async (subscription: SubscriptionViewModel) => {
    await toggle(subscription);
  };

  const handleFormSuccess = (
    suggestionId?: string,
    subscriptionData?: SubscriptionViewModel,
  ) => {
    if (subscriptionData) {
      upsert(subscriptionData, suggestionId);
    }

    setVerifyingSuggestion(null);
    router.refresh();
  };

  const handleRowClick = (row: SubscriptionOrSuggestion) => {
    // Don't open detail sheet for suggestions
    if (row.isSuggestion) {
      return;
    }
    // Find the full subscription data
    const subscription = subscriptions.find((s) => s.id === row.id);
    if (subscription) {
      setSelectedSubscription(subscription);
      setDetailSheetOpen(true);
    }
  };

  const handleEditFromDetail = (subscription: SubscriptionViewModel) => {
    setDetailSheetOpen(false);
    handleEdit(subscription);
  };

  return (
    <>
      <SubscriptionsGroupedList
        data={tableData}
        kpis={kpis}
        onAdd={handleAdd}
        onEdit={(row) => {
          const subscription = subscriptions.find((s) => s.id === row.id);
          if (subscription) handleEdit(subscription);
        }}
        onDelete={(row) => {
          const subscription = subscriptions.find((s) => s.id === row.id);
          if (subscription) handleDelete(subscription);
        }}
        onToggleActive={(row) => {
          const subscription = subscriptions.find((s) => s.id === row.id);
          if (subscription) handleToggleActive(subscription);
        }}
        onRowClick={handleRowClick}
        onVerify={handleVerify}
        onDismiss={handleDismiss}
      />

      <SubscriptionFormDialog
        open={formDialogOpen}
        onOpenChange={setFormDialogOpen}
        subscription={editingSubscription}
        suggestion={verifyingSuggestion}
        accounts={accounts}
        categories={categories}
        onSuccess={handleFormSuccess}
      />

      <SubscriptionDetailSheet
        subscription={selectedSubscription}
        open={detailSheetOpen}
        onOpenChange={setDetailSheetOpen}
        onEdit={handleEditFromDetail}
        onRefresh={() => router.refresh()}
      />
    </>
  );
}
