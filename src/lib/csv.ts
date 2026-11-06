/** One CSV field: quoted when it contains a comma, quote or newline. */
export const csvField = (v: unknown): string => {
  let s = v == null ? "" : String(v);
  // Stop spreadsheet formula injection from SAP-sourced text (a name starting with = + - @ would run as a formula).
  if (/^[=+\-@]/.test(s) && typeof v === "string") s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const toCsv = (header: string[], rows: unknown[][]): string =>
  [header.join(","), ...rows.map((r) => r.map(csvField).join(","))].join("\n");
