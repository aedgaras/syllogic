import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { PersonAvatar } from "./person-avatar";

describe("PersonAvatar", () => {
  it("renders initials from a two-word name", () => {
    render(<PersonAvatar person={{ id: "1", name: "Jane Doe" }} />);
    expect(screen.getByText("JD")).toBeTruthy();
  });

  it("renders the first two letters for a single-word name", () => {
    render(<PersonAvatar person={{ id: "1", name: "Madonna" }} />);
    expect(screen.getByText("MA")).toBeTruthy();
  });

  it("falls back to ? for an empty name", () => {
    render(<PersonAvatar person={{ id: "1", name: "" }} />);
    expect(screen.getByText("?")).toBeTruthy();
  });

  it("renders an image when avatarUrl is set instead of initials", () => {
    render(
      <PersonAvatar
        person={{ id: "1", name: "Jane Doe", avatarUrl: "/jane.png" }}
      />,
    );
    expect(screen.queryByText("JD")).toBeNull();
    const img = screen.getByRole("img", { name: "Jane Doe" });
    expect(img).toBeTruthy();
  });

  it("uses the given color as the initials background", () => {
    render(
      <PersonAvatar person={{ id: "1", name: "Jane Doe", color: "#123456" }} />,
    );
    expect(screen.getByText("JD").style.background).toBe("rgb(18, 52, 86)");
  });

  it("defaults to a gray background when no color is given", () => {
    render(<PersonAvatar person={{ id: "1", name: "Jane Doe" }} />);
    expect(screen.getByText("JD").style.background).toBe(
      "rgb(107, 114, 128)",
    );
  });

  it("scales font size and dimensions with the size prop", () => {
    render(<PersonAvatar person={{ id: "1", name: "Jane Doe" }} size={64} />);
    const el = screen.getByText("JD");
    expect(el.style.width).toBe("64px");
    expect(el.style.height).toBe("64px");
  });
});
