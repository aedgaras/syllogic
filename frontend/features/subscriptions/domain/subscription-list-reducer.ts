import type { SubscriptionSuggestionViewModel, SubscriptionViewModel } from "./contracts";

export interface SubscriptionListState {
  subscriptions: SubscriptionViewModel[];
  suggestions: SubscriptionSuggestionViewModel[];
}

export type SubscriptionListEvent =
  | { type: "subscription-upserted"; subscription: SubscriptionViewModel }
  | { type: "subscription-deleted"; id: string }
  | { type: "subscription-toggled"; id: string; isActive: boolean }
  | { type: "suggestion-dismissed"; id: string };

export function subscriptionListReducer(
  state: SubscriptionListState,
  event: SubscriptionListEvent
): SubscriptionListState {
  switch (event.type) {
    case "subscription-upserted": {
      const exists = state.subscriptions.some(({ id }) => id === event.subscription.id);
      return {
        ...state,
        subscriptions: exists
          ? state.subscriptions.map((item) => item.id === event.subscription.id ? event.subscription : item)
          : [...state.subscriptions, event.subscription],
      };
    }
    case "subscription-deleted":
      return { ...state, subscriptions: state.subscriptions.filter(({ id }) => id !== event.id) };
    case "subscription-toggled":
      return {
        ...state,
        subscriptions: state.subscriptions.map((item) =>
          item.id === event.id ? { ...item, isActive: event.isActive } : item
        ),
      };
    case "suggestion-dismissed":
      return { ...state, suggestions: state.suggestions.filter(({ id }) => id !== event.id) };
  }
}
