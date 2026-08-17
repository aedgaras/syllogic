import { describe, expect, it } from "vitest";
import { subscriptionListReducer, type SubscriptionListState } from "./subscription-list-reducer";

const initial = {
  subscriptions: [{ id: "sub-1", isActive: true }],
  suggestions: [{ id: "suggestion-1" }],
} as SubscriptionListState;

describe("subscription list reducer", () => {
  it("applies successful toggle and dismissal events", () => {
    const toggled = subscriptionListReducer(initial, { type: "subscription-toggled", id: "sub-1", isActive: false });
    expect(toggled.subscriptions[0].isActive).toBe(false);
    expect(subscriptionListReducer(toggled, { type: "suggestion-dismissed", id: "suggestion-1" }).suggestions).toEqual([]);
  });
});
