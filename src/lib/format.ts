const IST = "Asia/Kolkata";

/** Parse Postgres timestamptz text ("2026-10-23 04:28:02.4+00") or ISO text. */
function parseTimestamp(raw: string): Date {
  let t = raw.trim().replace(" ", "T");
  if (/[+-]\d{2}$/.test(t)) t += ":00"; // "+00" -> "+00:00"
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(t)) t += "Z"; // no offset: treat as UTC
  return new Date(t);
}

/** "23 Oct 2026, 9:58 am" in India time. */
export function formatWhen(raw: string): string {
  const d = parseTimestamp(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString("en-IN", { timeZone: IST, day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export const monthName = (m: number) => new Date(2000, m - 1, 1).toLocaleString("en-IN", { month: "long" });
export const qtyLabel = (q: number | null) => (q === null ? "–" : q === 0 ? "Pause" : new Intl.NumberFormat("en-IN").format(q));
