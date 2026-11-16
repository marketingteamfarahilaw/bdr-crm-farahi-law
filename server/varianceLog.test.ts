import { describe, expect, it } from "vitest";
import { varianceStatus } from "./varianceLog";
import { isClosed, monthEnd, wholeMonthOf } from "./monthLock";

const up = (id: number, day: string) => ({ id, uploadedAt: `2026-11-${day}T18:00:00.000Z` });
const item = (uploadId: number, itemKey: string, detail = "d") => ({ uploadId, kind: "status" as const, itemKey, name: itemKey, detail });

describe("varianceStatus", () => {
  const uploads = [up(1, "03"), up(2, "05"), up(3, "07")];
  const log = varianceStatus(uploads, [
    item(1, "ana"), item(2, "ana"), item(3, "ana", "latest"),   // found every time: open
    item(1, "ben"), item(2, "ben"),                             // gone from the latest: fixed on the 7th
    item(3, "cara"),                                            // new in the latest: open
  ]);
  const of = (k: string) => log.find((v) => v.itemKey === k)!;
  it("keeps a difference the latest comparison still finds open, with its latest detail", () => {
    expect(of("ana")).toMatchObject({ status: "open", times: 3, detail: "latest", fixedAt: null, firstSeen: uploads[0].uploadedAt });
  });
  it("marks one the latest comparison no longer finds fixed, as of the first comparison without it", () => {
    expect(of("ben")).toMatchObject({ status: "fixed", times: 2, fixedAt: uploads[2].uploadedAt, lastSeen: uploads[1].uploadedAt });
  });
  it("lists open differences first", () => {
    expect(log.map((v) => v.status)).toEqual(["open", "open", "fixed"]);
  });
  it("orders by upload time, whatever order the uploads come in", () => {
    const again = varianceStatus([...uploads].reverse(), [item(3, "x"), item(1, "y")]);
    expect(again.find((v) => v.itemKey === "y")!.status).toBe("fixed");
    expect(again.find((v) => v.itemKey === "x")!.status).toBe("open");
  });
});

describe("month locks", () => {
  it("knows a whole month", () => {
    expect(monthEnd("2026-02")).toBe("2026-02-28");
    expect(monthEnd("2028-02")).toBe("2028-02-29");
    expect(wholeMonthOf("2026-10-01", "2026-10-31")).toBe("2026-10");
    expect(wholeMonthOf("2026-10-01", "2026-10-30")).toBeNull();
    expect(wholeMonthOf("2026-10-02", "2026-10-31")).toBeNull();
    expect(wholeMonthOf("2026-09-01", "2026-10-31")).toBeNull();
  });
  it("only calls a month closed once it has ended", () => {
    expect(isClosed("2026-10", "2026-11-13")).toBe(true);
    expect(isClosed("2026-11", "2026-11-13")).toBe(false);
  });
});
