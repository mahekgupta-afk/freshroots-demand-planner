import { describe, it, expect } from "vitest";
import { formatWhen, qtyLabel } from "@/lib/format";

describe("formatWhen", () => {
  it("converts Postgres timestamptz text to India time", () => {
    expect(formatWhen("2026-10-23 04:28:02.400412+00")).toMatch(/23 Oct 2026, 9:58\s?am/i);
  });
  it("handles ISO strings and bare timestamps as UTC", () => {
    expect(formatWhen("2026-10-23T04:28:00Z")).toMatch(/9:58\s?am/i);
    expect(formatWhen("2026-10-23 04:28:00")).toMatch(/9:58\s?am/i);
  });
  it("returns the input unchanged when it cannot parse", () => {
    expect(formatWhen("not a date")).toBe("not a date");
  });
});

describe("qtyLabel", () => {
  it("formats none, pause and Indian-grouped numbers", () => {
    expect(qtyLabel(null)).toBe("–");
    expect(qtyLabel(0)).toBe("Pause");
    expect(qtyLabel(1250000)).toBe("12,50,000");
  });
});
