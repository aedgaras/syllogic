import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SubscriptionsClient } from "./subscriptions-client";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  toggleSubscriptionActive: vi.fn(),
  dismissSuggestion: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: vi.fn() },
}));
vi.mock("@/features/subscriptions/client/actions", () => ({
  toggleSubscriptionActive: mocks.toggleSubscriptionActive,
  deleteSubscription: vi.fn(),
  dismissSuggestion: mocks.dismissSuggestion,
}));
vi.mock("./subscription-form-dialog", () => ({
  SubscriptionFormDialog: () => null,
}));
vi.mock("./subscription-detail-sheet", () => ({
  SubscriptionDetailSheet: () => null,
}));
vi.mock("./subscriptions-grouped-list", () => ({
  SubscriptionsGroupedList: ({
    data,
    onToggleActive,
    onDismiss,
  }: {
    data: Array<{
      id: string;
      name: string;
      isSuggestion?: boolean;
      isActive?: boolean | null;
    }>;
    onToggleActive: (row: { id: string; isActive?: boolean | null }) => void;
    onDismiss: (row: { id: string }) => void;
  }) => (
    <div>
      <div data-testid="subscription-rows">
        {data.map((item) => `${item.name}:${String(item.isActive)}`).join("|")}
      </div>
      <button
        onClick={() => onToggleActive(data.find((item) => !item.isSuggestion)!)}
      >
        toggle subscription
      </button>
      <button
        onClick={() => onDismiss(data.find((item) => item.isSuggestion)!)}
      >
        dismiss suggestion
      </button>
    </div>
  ),
}));

const subscription = {
  id: "subscription-1",
  name: "Streaming",
  amount: "12.00",
  currency: "EUR",
  frequency: "monthly",
  isActive: true,
  logo: null,
};
const suggestion = {
  id: "suggestion-1",
  suggestedName: "Music",
  suggestedAmount: "8.00",
  currency: "EUR",
  detectedFrequency: "monthly",
  confidence: 92,
  matchCount: 3,
};

describe("SubscriptionsClient characterization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.toggleSubscriptionActive.mockResolvedValue({ success: true });
    mocks.dismissSuggestion.mockResolvedValue({ success: true });
  });

  it("persists a toggle and updates the client-owned list without a route refresh", async () => {
    render(
      <SubscriptionsClient
        initialSubscriptions={[subscription] as never}
        accounts={[]}
        categories={[]}
        suggestions={[suggestion] as never}
        kpis={{} as never}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "toggle subscription" }),
    );

    await waitFor(() =>
      expect(mocks.toggleSubscriptionActive).toHaveBeenCalledWith(
        "subscription-1",
        false,
      ),
    );
    expect(screen.getByTestId("subscription-rows")).toHaveTextContent(
      "Streaming:false",
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Subscription deactivated");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("removes a successfully dismissed suggestion without refreshing", async () => {
    render(
      <SubscriptionsClient
        initialSubscriptions={[subscription] as never}
        accounts={[]}
        categories={[]}
        suggestions={[suggestion] as never}
        kpis={{} as never}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "dismiss suggestion" }));

    await waitFor(() =>
      expect(mocks.dismissSuggestion).toHaveBeenCalledWith("suggestion-1"),
    );
    expect(screen.getByTestId("subscription-rows")).not.toHaveTextContent(
      "Music",
    );
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Suggestion dismissed");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
