import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssetManagement } from "@/features/assets/public";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  updateAccount: vi.fn(),
  deleteAccount: vi.fn(),
  saveOwners: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh, push: vi.fn() }) }));
vi.mock("sonner", () => ({
  toast: { success: mocks.toastSuccess, error: vi.fn(), info: vi.fn(), loading: vi.fn() },
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
  }),
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data: queryKey[1] === "logo-lookup-enabled" ? false : [{ personId: "person-1", share: null }],
    isSuccess: true,
  }),
  useMutation: ({ mutationFn, onSuccess, onError }: { mutationFn: (variables?: unknown) => Promise<unknown>; onSuccess?: () => void; onError?: (error: Error) => void }) => ({
    mutateAsync: async (variables?: unknown) => {
      try {
        const result = await mutationFn(variables);
        await onSuccess?.();
        return result;
      } catch (error) {
        onError?.(error as Error);
        throw error;
      }
    },
    isPending: false,
  }),
}));
vi.mock("@/features/accounts/client/actions", () => ({
  updateAccount: mocks.updateAccount,
  deleteAccount: mocks.deleteAccount,
  recalculateAccountTimeseries: vi.fn(),
}));
vi.mock("@/lib/actions/properties", () => ({ updateProperty: vi.fn(), deleteProperty: vi.fn() }));
vi.mock("@/lib/actions/vehicles", () => ({ updateVehicle: vi.fn(), deleteVehicle: vi.fn() }));
vi.mock("@/lib/actions/logos", () => ({ hasLogoApiKey: vi.fn().mockResolvedValue(false), searchLogo: vi.fn() }));
vi.mock("@/lib/people/client", () => ({
  fetchOwners: vi.fn().mockResolvedValue([{ personId: "person-1", share: null }]),
  ownersQueryKey: (type: string, id: string) => ["owners", type, id],
  saveOwners: mocks.saveOwners,
}));
vi.mock("@/components/command-palette-context", () => ({ useRegisterCommandPaletteCallbacks: vi.fn() }));
vi.mock("@/components/assets/add-asset-dialog", () => ({ AddAssetDialog: () => null }));
vi.mock("@/components/accounts/update-balance-dialog", () => ({ UpdateBalanceDialog: () => null }));
vi.mock("@/components/household/owner-badges", () => ({ OwnerBadges: () => null }));
vi.mock("@/components/household/owners-field", () => ({ OwnersField: () => null }));
vi.mock("@/components/ui/account-logo", () => ({ AccountLogo: () => null }));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: React.PropsWithChildren<{ onClick?: () => void }>) => <button onClick={onClick}>{children}</button>,
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: React.PropsWithChildren<{ open?: boolean }>) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  DialogDescription: ({ children }: React.PropsWithChildren) => <p>{children}</p>,
  DialogFooter: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  DialogHeader: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  DialogTitle: ({ children }: React.PropsWithChildren) => <h2>{children}</h2>,
}));
vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ open, children }: React.PropsWithChildren<{ open?: boolean }>) => open ? <div>{children}</div> : null,
  AlertDialogAction: ({ children, onClick }: React.PropsWithChildren<{ onClick?: () => void }>) => <button onClick={onClick}>{children}</button>,
  AlertDialogCancel: ({ children }: React.PropsWithChildren) => <button>{children}</button>,
  AlertDialogContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: React.PropsWithChildren) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: React.PropsWithChildren) => <h2>{children}</h2>,
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  SelectContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  SelectItem: ({ children }: React.PropsWithChildren) => <span>{children}</span>,
  SelectTrigger: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  SelectValue: () => null,
}));

const account = {
  id: "account-1",
  name: "Everyday",
  accountType: "checking",
  institution: "Bank",
  currency: "EUR",
  balance: "100.00",
  logo: null,
  ownerIds: ["person-1"],
};

const model = {
  accounts: [account],
  properties: [],
  vehicles: [],
  people: [{ id: "person-1", name: "Owner", kind: "self" }],
};

describe("AssetManagement account workflow characterization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateAccount.mockResolvedValue({ success: true });
    mocks.deleteAccount.mockResolvedValue({ success: true });
    mocks.saveOwners.mockResolvedValue(undefined);
  });

  it("hydrates the edit form, saves account fields and ownership, then refreshes", async () => {
    render(<AssetManagement model={model} />);

    fireEvent.click(screen.getAllByRole("button", { name: /edit/i })[0]);
    const name = await screen.findByLabelText("Account Name");
    fireEvent.change(name, { target: { value: "Daily spending" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(mocks.updateAccount).toHaveBeenCalled());
    expect(mocks.updateAccount.mock.calls[0]).toEqual([
      "account-1",
      expect.objectContaining({ name: "Daily spending", accountType: "checking", currency: "EUR" }),
    ]);
    expect(mocks.saveOwners).toHaveBeenCalledWith("account", "account-1", [{ personId: "person-1", share: null }]);
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Account updated");
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("requires confirmation, deletes the selected account, and refreshes", async () => {
    render(<AssetManagement model={model} />);

    fireEvent.click(screen.getAllByRole("button", { name: /delete/i })[0]);
    expect(await screen.findByRole("heading", { name: "Delete Account" })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" }).at(-1)!);

    await waitFor(() => expect(mocks.deleteAccount).toHaveBeenCalledWith("account-1"));
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Account deleted");
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
});
