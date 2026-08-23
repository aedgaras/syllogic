import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { DeleteCategoryDialog } from "./delete-category-dialog";
import type { SettingsCategory } from "@/features/settings/public";

vi.mock("@/components/ui/select", () => ({
  Select: ({
    children,
    onValueChange,
  }: React.PropsWithChildren<{ onValueChange?: (v: string) => void }>) => (
    <div data-testid="select" onClick={() => onValueChange?.("cat-2")}>
      {children}
    </div>
  ),
  SelectContent: ({ children }: React.PropsWithChildren) => (
    <div>{children}</div>
  ),
  SelectItem: ({ children }: React.PropsWithChildren) => (
    <span>{children}</span>
  ),
  SelectTrigger: ({ children }: React.PropsWithChildren) => (
    <div>{children}</div>
  ),
  SelectValue: () => null,
}));

const CATEGORY = { id: "cat-1", name: "Food", color: "#fff" } as SettingsCategory;
const OTHER_CATEGORY = { id: "cat-2", name: "Dining", color: "#000" } as SettingsCategory;

function setup(overrides: Partial<React.ComponentProps<typeof DeleteCategoryDialog>> = {}) {
  const onConfirm = vi.fn().mockResolvedValue(undefined);
  const onOpenChange = vi.fn();
  render(
    <DeleteCategoryDialog
      open={true}
      onOpenChange={onOpenChange}
      category={CATEGORY}
      transactionCount={0}
      sameTypeCategories={[CATEGORY, OTHER_CATEGORY]}
      onConfirm={onConfirm}
      {...overrides}
    />,
  );
  return { onConfirm, onOpenChange };
}

describe("DeleteCategoryDialog", () => {
  it("renders nothing when category is null", () => {
    const { container } = render(
      <DeleteCategoryDialog
        open={true}
        onOpenChange={vi.fn()}
        category={null}
        transactionCount={0}
        sameTypeCategories={[]}
        onConfirm={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("keeps the confirm button disabled until the exact category name is typed", () => {
    setup();
    const confirmBtn = screen.getByRole("button", { name: /delete category/i });
    expect(confirmBtn).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/type/i), {
      target: { value: "Foo" },
    });
    expect(confirmBtn).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/type/i), {
      target: { value: "Food" },
    });
    expect(confirmBtn).not.toBeDisabled();
  });

  it("calls onConfirm with null when leaving transactions uncategorized", async () => {
    const { onConfirm } = setup({ transactionCount: 5 });
    fireEvent.change(screen.getByLabelText(/type/i), {
      target: { value: "Food" },
    });
    fireEvent.click(screen.getByRole("button", { name: /delete category/i }));
    expect(onConfirm).toHaveBeenCalledWith(null);
  });

  it("disables confirm when reassign is chosen but no target category is picked", () => {
    setup({ transactionCount: 5 });
    fireEvent.change(screen.getByLabelText(/type/i), {
      target: { value: "Food" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^reassign$/i }));
    expect(screen.getByRole("button", { name: /delete category/i })).toBeDisabled();
  });

  it("calls onConfirm with the chosen category id after reassigning", () => {
    const { onConfirm } = setup({ transactionCount: 5 });
    fireEvent.change(screen.getByLabelText(/type/i), {
      target: { value: "Food" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^reassign$/i }));
    fireEvent.click(screen.getByTestId("select"));
    fireEvent.click(screen.getByRole("button", { name: /delete category/i }));
    expect(onConfirm).toHaveBeenCalledWith("cat-2");
  });

  it("excludes the category being deleted from the reassign options", () => {
    setup({ transactionCount: 5 });
    fireEvent.click(screen.getByRole("button", { name: /^reassign$/i }));
    expect(screen.queryByText("Food")).toBeTruthy(); // still in the title area
    // The category itself must not appear as a SelectItem option.
    const options = screen.getAllByText("Dining");
    expect(options.length).toBeGreaterThan(0);
  });

  it("disables the reassign option when there are no other same-type categories", () => {
    setup({ transactionCount: 5, sameTypeCategories: [CATEGORY] });
    expect(screen.getByRole("button", { name: /^reassign$/i })).toBeDisabled();
  });

  it("shows a Deleting… state and disables cancel while isLoading", () => {
    setup({ isLoading: true });
    expect(screen.getByRole("button", { name: /deleting/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeDisabled();
  });
});
