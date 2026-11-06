import type { RecStatus } from "@/lib/rules/engine";

export const STATUS_LABEL: Record<RecStatus, string> = {
  stockout: "Stockout",
  needs_review: "Needs review",
  high_demand: "High demand",
  overstock: "Overstock",
  on_track: "On track",
};

const STYLE: Record<RecStatus, string> = {
  stockout: "bg-red-100 text-red-800",
  needs_review: "bg-amber-100 text-amber-800",
  high_demand: "bg-blue-100 text-blue-800",
  overstock: "bg-purple-100 text-purple-800",
  on_track: "bg-emerald-100 text-emerald-800",
};

export function StatusBadge({ status }: { status: RecStatus }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Solid colours for charts and dots. Same hues as the badges above so a status always looks the same. */
export const STATUS_SOLID: Record<RecStatus, string> = {
  stockout: "bg-red-500",
  needs_review: "bg-amber-500",
  high_demand: "bg-blue-500",
  overstock: "bg-purple-500",
  on_track: "bg-emerald-500",
};
