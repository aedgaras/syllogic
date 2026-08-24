"use client";
import { t as translate } from "@/i18n/translate";

import type { Holding } from "@/lib/api/investments";

export function HoldingsTable({
  holdings,
  onDelete,
  onSell,
}: {
  holdings: Holding[];
  onDelete?: (id: string) => void;
  onSell?: (holding: Holding) => void;
}) {
  const canSell = (h: Holding) => h.source === "manual" && h.instrument_type !== "cash";
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
                className={`shrink-0 text-right text-sm font-medium ${h.is_stale ? "text-warning" : ""}`}
              >
                {h.current_value_user_currency ?? "—"}
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div>
                <div className="text-muted-foreground">{translate("type")}</div>
                <div className="capitalize">{h.instrument_type}</div>
              </div>
              <div className="text-right">
                <div className="text-muted-foreground">{translate("qty")}</div>
                <div>{h.quantity}</div>
              </div>
              <div>
                <div className="text-muted-foreground">
                  {translate("price")}
                </div>
                <div>
                  {h.current_price ?? "—"} {h.currency}
                </div>
              </div>
              <div className="text-right space-x-2">
                {onSell && canSell(h) && (
                  <button
                    type="button"
                    className="text-xs text-primary"
                    onClick={() => onSell(h)}
                  >
                    {translate("sell")}
                  </button>
                )}
                {onDelete && h.source === "manual" && (
                  <button
                    type="button"
                    className="text-xs text-destructive"
                    onClick={() => onDelete(h.id)}
                  >
                    {translate("remove")}
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
            <th>{translate("symbol")}</th>
            <th>{translate("type")}</th>
            <th className="text-right">{translate("qty")}</th>
            <th className="text-right">{translate("price")}</th>
            <th className="text-right">{translate("value")}</th>
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
                className={`text-right ${h.is_stale ? "text-warning" : ""}`}
              >
                {h.current_value_user_currency ?? "—"}
              </td>
              <td className="text-right space-x-2">
                {onSell && canSell(h) && (
                  <button
                    type="button"
                    className="text-xs text-primary"
                    onClick={() => onSell(h)}
                  >
                    {translate("sell")}
                  </button>
                )}
                {onDelete && h.source === "manual" && (
                  <button
                    type="button"
                    className="text-xs text-destructive"
                    onClick={() => onDelete(h.id)}
                  >
                    {translate("remove")}
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
