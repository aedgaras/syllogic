import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { AssetTypeSelector } from "./asset-type-selector";

describe("AssetTypeSelector", () => {
  it("renders a button for each of property, vehicle, and account", () => {
    render(<AssetTypeSelector onSelect={vi.fn()} />);
    expect(screen.getByText("Property")).toBeTruthy();
    expect(screen.getByText("Vehicle")).toBeTruthy();
    expect(screen.getByText("Account")).toBeTruthy();
  });

  it("calls onSelect with the vehicle type when that button is clicked", () => {
    const onSelect = vi.fn();
    render(<AssetTypeSelector onSelect={onSelect} />);
    fireEvent.click(screen.getByText("Vehicle").closest("button")!);
    expect(onSelect).toHaveBeenCalledWith("vehicle");
  });

  it("calls onSelect with the property type when that button is clicked", () => {
    const onSelect = vi.fn();
    render(<AssetTypeSelector onSelect={onSelect} />);
    fireEvent.click(screen.getByText("Property").closest("button")!);
    expect(onSelect).toHaveBeenCalledWith("property");
  });

  it("calls onSelect with the account type when that button is clicked", () => {
    const onSelect = vi.fn();
    render(<AssetTypeSelector onSelect={onSelect} />);
    fireEvent.click(screen.getByText("Account").closest("button")!);
    expect(onSelect).toHaveBeenCalledWith("account");
  });
});
