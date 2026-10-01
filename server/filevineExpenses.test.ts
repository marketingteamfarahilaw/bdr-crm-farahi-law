import { describe, expect, it } from "vitest";
import { matchExpenses, type FvSide, type SheetSide } from "./filevineExpenses";

const fv = (id: string, rep: string, day: string | null, amount: number): FvSide => ({ id, rep, day, amount, store: null, type: null, payment: null });
const sh = (id: number, rep: string, day: string | null, amount: number): SheetSide => ({ id, rep, day, amount, store: null, facility: null, reason: null, card: null });

describe("matchExpenses", () => {
  it("pairs same rep and amount within 3 days, nearest date first", () => {
    const r = matchExpenses([fv("a", "Zulema Salas", "2026-09-10", 25)], [sh(1, "Zulema Salas", "2026-09-13", 25), sh(2, "Zulema Salas", "2026-09-11", 25)]);
    expect(r.matched.map((p) => p.sheet.id)).toEqual([2]);
    expect(r.onlySheet.map((s) => s.id)).toEqual([1]);
  });

  it("never pairs a different rep or a different amount", () => {
    const r = matchExpenses([fv("a", "Zulema Salas", "2026-09-10", 25)], [sh(1, "Lupe Campos", "2026-09-10", 25), sh(2, "Zulema Salas", "2026-09-10", 25.01)]);
    expect(r.matched).toEqual([]);
    expect(r.onlyFilevine.map((f) => f.id)).toEqual(["a"]);
    expect(r.onlySheet).toHaveLength(2);
  });

  it("uses each sheet row once, so a duplicate in Filevine shows up", () => {
    const r = matchExpenses([fv("a", "Jezel Mercado", "2026-03-09", 60.15), fv("b", "Jezel Mercado", "2026-03-09", 60.15)], [sh(1, "Jezel Mercado", "2026-03-09", 60.15)]);
    expect(r.matched).toHaveLength(1);
    expect(r.onlyFilevine).toHaveLength(1);
  });

  it("reports a date up to 14 days off, or a missing date, as a loose match", () => {
    const r = matchExpenses([fv("a", "Lupe Campos", "2026-05-01", 40), fv("b", "Lupe Campos", null, 12)], [sh(1, "Lupe Campos", "2026-05-12", 40), sh(2, "Lupe Campos", "2026-05-02", 12)]);
    expect(r.matched).toEqual([]);
    expect(r.loose.map((p) => [p.fv.id, p.sheet.id, p.daysApart])).toEqual([["a", 1, 11], ["b", 2, 14]]);
  });
});
