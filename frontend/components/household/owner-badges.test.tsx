import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { OwnerBadges } from "./owner-badges";
import type { ClientPerson, OwnerRow } from "@/lib/people/client";

const { usePeopleQuery, useOwnersQuery } = vi.hoisted(() => ({
  usePeopleQuery: vi.fn(),
  useOwnersQuery: vi.fn(),
}));

vi.mock("@/lib/people/client", () => ({ usePeopleQuery, useOwnersQuery }));

const PEOPLE: ClientPerson[] = [
  { id: "p1", name: "Alice", kind: "adult" },
  { id: "p2", name: "Bob", kind: "adult" },
  { id: "p3", name: "Cara", kind: "adult" },
  { id: "p4", name: "Dave", kind: "adult" },
];

function owners(ids: string[]): OwnerRow[] {
  return ids.map((personId) => ({ personId, share: null }));
}

describe("OwnerBadges", () => {
  it("renders nothing in a single-person household", () => {
    usePeopleQuery.mockReturnValue({ data: [PEOPLE[0]] });
    useOwnersQuery.mockReturnValue({ data: owners(["p1"]) });
    const { container } = render(
      <OwnerBadges entityType="account" entityId="e1" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when the entity has no owners", () => {
    usePeopleQuery.mockReturnValue({ data: PEOPLE.slice(0, 2) });
    useOwnersQuery.mockReturnValue({ data: [] });
    const { container } = render(
      <OwnerBadges entityType="account" entityId="e1" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders an avatar for each owner", () => {
    usePeopleQuery.mockReturnValue({ data: PEOPLE.slice(0, 2) });
    useOwnersQuery.mockReturnValue({ data: owners(["p1", "p2"]) });
    render(<OwnerBadges entityType="account" entityId="e1" />);
    expect(screen.getByTitle("Alice")).toBeTruthy();
    expect(screen.getByTitle("Bob")).toBeTruthy();
  });

  it("caps visible avatars at max and shows a +N overflow badge", () => {
    usePeopleQuery.mockReturnValue({ data: PEOPLE });
    useOwnersQuery.mockReturnValue({
      data: owners(["p1", "p2", "p3", "p4"]),
    });
    render(<OwnerBadges entityType="account" entityId="e1" max={2} />);
    expect(screen.getByTitle("Alice")).toBeTruthy();
    expect(screen.getByTitle("Bob")).toBeTruthy();
    expect(screen.queryByTitle("Cara")).toBeNull();
    expect(screen.getByText("+2")).toBeTruthy();
  });

  it("only shows badges for people who are actual owners of the entity", () => {
    usePeopleQuery.mockReturnValue({ data: PEOPLE.slice(0, 2) });
    useOwnersQuery.mockReturnValue({ data: owners(["p1"]) });
    render(<OwnerBadges entityType="account" entityId="e1" />);
    expect(screen.getByTitle("Alice")).toBeTruthy();
    expect(screen.queryByTitle("Bob")).toBeNull();
  });
});
