"use client";
import type { Holding } from "@/lib/api/investments";

export function HoldingsTable({
  holdings,
  onDelete,
}: {
  holdings: Holding[];
  onDelete?: (id: string) => void;
}) {
  return (
    <>
    <div className="space-y-2 md:hidden">
      {holdings.map((h) => (
        <article key={h.id} className="rounded border p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-medium">{h.symbol}</div>
              <div className="break-words text-xs text-muted-foreground">
                {h.name}
              </div>
            </div>
            <div
              className={`shrink-0 text-right text-sm font-medium ${h.is_stale ? "text-amber-600" : ""}`}
            >
              {h.current_value_user_currency ?? "—"}
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div>
              <div className="text-muted-foreground">Type</div>
              <div className="capitalize">{h.instrument_type}</div>
            </div>
            <div className="text-right">
              <div className="text-muted-foreground">Qty</div>
              <div>{h.quantity}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Price</div>
              <div>
                {h.current_price ?? "—"} {h.currency}
              </div>
            </div>
            <div className="text-right">
              {onDelete && h.source === "manual" && (
                <button
                  type="button"
                  className="text-xs text-red-600"
                  onClick={() => onDelete(h.id)}
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        </article>
      ))}
    </div>
    <table className="hidden w-full text-sm md:table">
      <thead className="text-left text-muted-foreground">
        <tr>
          <th>Symbol</th>
          <th>Type</th>
          <th className="text-right">Qty</th>
          <th className="text-right">Price</th>
          <th className="text-right">Value</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {holdings.map((h) => (
          <tr key={h.id} className="border-t">
            <td className="py-2">
              <span className="font-medium">{h.symbol}</span>{" "}
              <span className="text-xs text-muted-foreground">{h.name}</span>
            </td>
            <td>{h.instrument_type}</td>
            <td className="text-right">{h.quantity}</td>
            <td className="text-right">
              {h.current_price ?? "—"} {h.currency}
            </td>
            <td
              className={`text-right ${h.is_stale ? "text-amber-600" : ""}`}
            >
              {h.current_value_user_currency ?? "—"}
            </td>
            <td className="text-right">
              {onDelete && h.source === "manual" && (
                <button
                  type="button"
                  className="text-xs text-red-600"
                  onClick={() => onDelete(h.id)}
                >
                  Remove
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    </>
  );
}
