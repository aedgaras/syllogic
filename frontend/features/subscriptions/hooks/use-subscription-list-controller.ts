"use client";

import { useReducer } from "react";
import { toast } from "sonner";
import {
  deleteSubscription,
  dismissSuggestion,
  toggleSubscriptionActive,
} from "../client/actions";
import type {
  SubscriptionSuggestionViewModel,
  SubscriptionViewModel,
} from "../public";
import { subscriptionListReducer } from "../domain/subscription-list-reducer";

export function useSubscriptionListController(
  initialSubscriptions: SubscriptionViewModel[],
  initialSuggestions: SubscriptionSuggestionViewModel[],
) {
  // This reducer is the explicit owner of list data for the lifetime of the screen.
  // Mutations update it only after the server confirms success; route refresh is not
  // mixed into list mutation handling.
  const [state, dispatch] = useReducer(subscriptionListReducer, {
    subscriptions: initialSubscriptions,
    suggestions: initialSuggestions,
  });

  async function dismiss(id: string) {
    const result = await dismissSuggestion(id);
    if (!result.success)
      return toast.error(result.error || "Failed to dismiss suggestion");
    dispatch({ type: "suggestion-dismissed", id });
    toast.success("Suggestion dismissed");
  }

  async function remove(subscription: SubscriptionViewModel) {
    const result = await deleteSubscription(subscription.id);
    if (!result.success) return toast.error(result.error || "Failed to delete");
    dispatch({ type: "subscription-deleted", id: subscription.id });
    toast.success("Subscription deleted");
  }

  async function toggle(subscription: SubscriptionViewModel) {
    const isActive = !subscription.isActive;
    const result = await toggleSubscriptionActive(subscription.id, isActive);
    if (!result.success)
      return toast.error(result.error || "Failed to update status");
    dispatch({ type: "subscription-toggled", id: subscription.id, isActive });
    toast.success(
      isActive ? "Subscription activated" : "Subscription deactivated",
    );
  }

  function upsert(subscription: SubscriptionViewModel, suggestionId?: string) {
    dispatch({ type: "subscription-upserted", subscription });
    if (suggestionId)
      dispatch({ type: "suggestion-dismissed", id: suggestionId });
  }

  return { ...state, dismiss, remove, toggle, upsert };
}
