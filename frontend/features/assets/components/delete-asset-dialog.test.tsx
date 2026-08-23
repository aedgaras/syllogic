import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { DeleteAssetDialog } from "./delete-asset-dialog";

describe("DeleteAssetDialog", () => {
  it("renders nothing when closed", () => {
    render(
      <DeleteAssetDialog
        type="property"
        name="My House"
        open={false}
        pending={false}
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.queryByText(/my house/i)).toBeNull();
  });

  it("capitalizes the asset type in the title", () => {
    render(
      <DeleteAssetDialog
        type="vehicle"
        name="My Car"
        open={true}
        pending={false}
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByText(/Delete Vehicle/)).toBeTruthy();
  });

  it("calls onConfirm when the delete action is clicked", () => {
    const onConfirm = vi.fn();
    render(
      <DeleteAssetDialog
        type="property"
        name="My House"
        open={true}
        pending={false}
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it("disables both buttons and shows Deleting… while pending", () => {
    render(
      <DeleteAssetDialog
        type="property"
        name="My House"
        open={true}
        pending={true}
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /deleting/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeDisabled();
  });
});
