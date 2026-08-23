import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { WeightBarVisualizer } from "./weight-bar-visualizer";

function bars(container: HTMLElement): HTMLElement[] {
  return Array.from(container.firstElementChild!.children) as HTMLElement[];
}

function filledBarCount(container: HTMLElement, color: string) {
  return bars(container).filter((el) => el.style.backgroundColor === color)
    .length;
}

describe("WeightBarVisualizer", () => {
  it("always renders 10 bars", () => {
    const { container } = render(
      <WeightBarVisualizer percentage={50} color="red" />,
    );
    expect(bars(container).length).toBe(10);
  });

  it("fills no bars at 0%", () => {
    const { container } = render(
      <WeightBarVisualizer percentage={0} color="red" />,
    );
    expect(filledBarCount(container, "red")).toBe(0);
  });

  it("fills all 10 bars at 100%", () => {
    const { container } = render(
      <WeightBarVisualizer percentage={100} color="red" />,
    );
    expect(filledBarCount(container, "red")).toBe(10);
  });

  it("rounds to the nearest bar for a fractional percentage", () => {
    const { container } = render(
      <WeightBarVisualizer percentage={24} color="red" />,
    );
    expect(filledBarCount(container, "red")).toBe(2);
  });

  it("never fills a negative number of bars for negative input", () => {
    const { container } = render(
      <WeightBarVisualizer percentage={-20} color="red" />,
    );
    expect(filledBarCount(container, "red")).toBe(0);
  });
});
