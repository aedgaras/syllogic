import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { CategoryRow } from "./category-row";
import type { CategoryInput } from "@/lib/actions/categories";

function category(overrides: Partial<CategoryInput> = {}): CategoryInput {
  return {
    name: "Groceries",
    categoryType: "expense",
    color: "#00ff00",
    icon: "cart",
    ...overrides,
  };
}

describe("CategoryRow", () => {
  it("renders the category name", () => {
    render(<CategoryRow category={category()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText("Groceries")).toBeTruthy();
  });

  it("renders the description when present", () => {
    render(
      <CategoryRow
        category={category({ description: "Food and household items" })}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText("Food and household items")).toBeTruthy();
  });

  it("shows a System badge and hides the delete button for system categories", () => {
    render(
      <CategoryRow
        category={category({ isSystem: true })}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText(/system/i)).toBeTruthy();
    expect(screen.queryByTitle(/delete category/i)).toBeNull();
  });

  it("shows a delete button for non-system categories", () => {
    render(
      <CategoryRow
        category={category({ isSystem: false })}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByTitle(/delete category/i)).toBeTruthy();
  });

  it("calls onEdit when the edit button is clicked", () => {
    const onEdit = vi.fn();
    render(<CategoryRow category={category()} onEdit={onEdit} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByTitle(/edit category/i));
    expect(onEdit).toHaveBeenCalled();
  });

  it("calls onDelete when the delete button is clicked", () => {
    const onDelete = vi.fn();
    render(<CategoryRow category={category()} onEdit={vi.fn()} onDelete={onDelete} />);
    fireEvent.click(screen.getByTitle(/delete category/i));
    expect(onDelete).toHaveBeenCalled();
  });
});
