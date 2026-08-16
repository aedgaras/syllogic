/* eslint-disable @typescript-eslint/no-unused-vars */
import type { ReactNode } from "react";

declare module "@tanstack/react-table" {
  interface ColumnMeta<_TData, _TValue> {
    mobileLabel?: ReactNode;
    mobilePriority?: "primary" | "secondary" | "hidden";
    mobileClassName?: string;
  }
}
