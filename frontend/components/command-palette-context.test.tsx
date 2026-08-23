import { render, screen, fireEvent } from "@testing-library/react";
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import {
  CommandPaletteProvider,
  useCommandPaletteCallbacks,
  useRegisterCommandPaletteCallbacks,
} from "./command-palette-context";

describe("useCommandPaletteCallbacks", () => {
  it("throws when used outside a CommandPaletteProvider", () => {
    const { result } = renderHook(() => {
      try {
        return useCommandPaletteCallbacks();
      } catch (e) {
        return e as Error;
      }
    });
    expect(result.current).toBeInstanceOf(Error);
    expect((result.current as Error).message).toMatch(/CommandPaletteProvider/);
  });

  it("starts with no registered callbacks", () => {
    const { result } = renderHook(() => useCommandPaletteCallbacks(), {
      wrapper: CommandPaletteProvider,
    });
    expect(result.current.callbacks).toEqual({});
  });

  it("registerCallbacks merges new callbacks into state", () => {
    const { result } = renderHook(() => useCommandPaletteCallbacks(), {
      wrapper: CommandPaletteProvider,
    });
    const onAddTransaction = vi.fn();
    act(() => {
      result.current.registerCallbacks({ onAddTransaction });
    });
    expect(result.current.callbacks.onAddTransaction).toBe(onAddTransaction);
  });

  it("unregisterCallbacks removes only the given keys", () => {
    const { result } = renderHook(() => useCommandPaletteCallbacks(), {
      wrapper: CommandPaletteProvider,
    });
    const onAddTransaction = vi.fn();
    const onExportCSV = vi.fn();
    act(() => {
      result.current.registerCallbacks({ onAddTransaction, onExportCSV });
    });
    act(() => {
      result.current.unregisterCallbacks(["onAddTransaction"]);
    });
    expect(result.current.callbacks.onAddTransaction).toBeUndefined();
    expect(result.current.callbacks.onExportCSV).toBe(onExportCSV);
  });
});

describe("useRegisterCommandPaletteCallbacks", () => {
  function Consumer() {
    const { callbacks } = useCommandPaletteCallbacks();
    return (
      <div data-testid="state">
        {callbacks.onAddTransaction ? "registered" : "empty"}
      </div>
    );
  }

  function Registrar({ active }: { active: boolean }) {
    useRegisterCommandPaletteCallbacks(
      active ? { onAddTransaction: () => {} } : {},
      [active],
    );
    return null;
  }

  it("registers its callbacks into the shared context on mount", () => {
    render(
      <CommandPaletteProvider>
        <Consumer />
        <Registrar active />
      </CommandPaletteProvider>,
    );
    expect(screen.getByTestId("state").textContent).toBe("registered");
  });

  it("unregisters its callbacks when unmounted", () => {
    function Harness() {
      const [mounted, setMounted] = useState(true);
      return (
        <CommandPaletteProvider>
          <Consumer />
          {mounted && <Registrar active />}
          <button onClick={() => setMounted(false)}>unmount</button>
        </CommandPaletteProvider>
      );
    }
    render(<Harness />);
    expect(screen.getByTestId("state").textContent).toBe("registered");
    fireEvent.click(screen.getByRole("button", { name: "unmount" }));
    expect(screen.getByTestId("state").textContent).toBe("empty");
  });
});
