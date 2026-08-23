import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PersonFilter } from "./person-filter";

const { usePeopleQuery } = vi.hoisted(() => ({ usePeopleQuery: vi.fn() }));

vi.mock("@/lib/people/client", () => ({ usePeopleQuery }));

const PEOPLE = [
  { id: "p1", name: "Alice" },
  { id: "p2", name: "Bob" },
];

describe("PersonFilter", () => {
  it("renders nothing for a single-person household", () => {
    usePeopleQuery.mockReturnValue({ data: [{ id: "p1", name: "Alice" }] });
    const { container } = render(
      <PersonFilter value={[]} onChange={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing while people data is still loading (undefined)", () => {
    usePeopleQuery.mockReturnValue({ data: undefined });
    const { container } = render(
      <PersonFilter value={[]} onChange={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders an All button plus one button per person", () => {
    usePeopleQuery.mockReturnValue({ data: PEOPLE });
    render(<PersonFilter value={[]} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /all/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Alice/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Bob/i })).toBeTruthy();
  });

  it("adds a person id when their button is clicked while unselected", () => {
    usePeopleQuery.mockReturnValue({ data: PEOPLE });
    const onChange = vi.fn();
    render(<PersonFilter value={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Alice/i }));
    expect(onChange).toHaveBeenCalledWith(["p1"]);
  });

  it("removes a person id when their button is clicked while selected", () => {
    usePeopleQuery.mockReturnValue({ data: PEOPLE });
    const onChange = vi.fn();
    render(<PersonFilter value={["p1", "p2"]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Alice/i }));
    expect(onChange).toHaveBeenCalledWith(["p2"]);
  });

  it("clears the selection when the All button is clicked", () => {
    usePeopleQuery.mockReturnValue({ data: PEOPLE });
    const onChange = vi.fn();
    render(<PersonFilter value={["p1"]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /^all$/i }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
