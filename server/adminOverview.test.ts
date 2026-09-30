import { describe, expect, it } from "vitest";
import { monthKey, sudDay, whoIs } from "./adminOverview";

describe("sudDay", () => {
  it("reads the sheet's date shapes", () => {
    expect(sudDay("2026-06-11")).toBe("2026-06-11");
    expect(sudDay("6/11/2026")).toBe("2026-06-11");
    expect(sudDay("6/11/26")).toBe("2026-06-11");
  });
  it("dates a reward covering several sign-ups by the last of them", () => {
    expect(sudDay("3/4/2026 3/10/2026 6/2/2026")).toBe("2026-06-02");
    expect(sudDay("12/23/2025 12/27/2025")).toBe("2025-12-27");
  });
  it("keeps a typo'd year as written, for the caller to reject", () => {
    expect(sudDay("3/23/0206")).toBe("0206-03-23");
  });
  it("has no date for blanks and NA", () => {
    expect(sudDay("")).toBeNull();
    expect(sudDay("NA")).toBeNull();
    expect(sudDay("n/a")).toBeNull();
    expect(sudDay(null)).toBeNull();
  });
});

describe("monthKey", () => {
  it("reads tracker months", () => {
    expect(monthKey("May 2026")).toBe("2026-05");
    expect(monthKey("September 2025")).toBe("2025-09");
    expect(monthKey("Sept. 2025")).toBe("2025-09");
    expect(monthKey("soon")).toBeNull();
  });
});

describe("whoIs", () => {
  it("matches today's team by full name, first name or a typo'd prefix", () => {
    expect(whoIs("Lupe Campos")).toMatchObject({ name: "Lupe Campos", role: "FR", current: true });
    expect(whoIs("lupe")).toMatchObject({ name: "Lupe Campos", current: true });
    expect(whoIs("Quee")).toMatchObject({ name: "Queenie Miranda", role: "BDR", current: true });
  });
  it("keeps anyone else as a former rep, and no rep as nobody", () => {
    expect(whoIs("Genysys Sanchez")).toMatchObject({ role: "Former", current: false });
    expect(whoIs("(unknown)")).toBeNull();
    expect(whoIs("  ")).toBeNull();
  });
});
