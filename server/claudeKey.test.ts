import { describe, expect, it } from "vitest";
import { decryptKey, encryptKey } from "./_core/claude";

// The Anthropic key an admin saves in Settings is stored encrypted with the
// server's JWT_SECRET; nothing else should be able to read it back.
describe("Claude key storage", () => {
  const key = "sk-ant-api03-EXAMPLEexampleEXAMPLEexample0000";

  it("reads back what it stored", () => {
    expect(decryptKey(encryptKey(key, "secret-a"), "secret-a")).toBe(key);
  });

  it("never stores the key in the clear, and never the same way twice", () => {
    const a = encryptKey(key, "secret-a"), b = encryptKey(key, "secret-a");
    expect(a).not.toContain(key);
    expect(a).not.toBe(b);
  });

  it("can't be read with another secret, or once tampered with", () => {
    const stored = encryptKey(key, "secret-a");
    expect(decryptKey(stored, "secret-b")).toBeNull();
    const parts = stored.split(":");
    parts[3] = Buffer.from("x" + Buffer.from(parts[3], "base64").toString("latin1").slice(1), "latin1").toString("base64");
    expect(decryptKey(parts.join(":"), "secret-a")).toBeNull();
    expect(decryptKey("garbage", "secret-a")).toBeNull();
  });

  it("refuses to store without a server secret", () => {
    expect(() => encryptKey(key, "")).toThrow();
  });
});
