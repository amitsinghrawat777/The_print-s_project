import { describe, expect, it } from "vitest";
import {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  sha256Hex,
  signBody,
  verifySignature,
} from "../src/signing.js";

describe("request signing", () => {
  const secret = "test-secret";
  const body = JSON.stringify({ fileId: "abc" });

  it("verifies its own signature", async () => {
    const h = await signBody(secret, body, 1000);
    expect(await verifySignature(secret, body, h[TIMESTAMP_HEADER], h[SIGNATURE_HEADER], 1010)).toBe(
      true,
    );
  });

  it("rejects tampered body, wrong secret and stale timestamps", async () => {
    const h = await signBody(secret, body, 1000);
    const ts = h[TIMESTAMP_HEADER];
    const sig = h[SIGNATURE_HEADER];
    expect(await verifySignature(secret, body + " ", ts, sig, 1000)).toBe(false);
    expect(await verifySignature("other", body, ts, sig, 1000)).toBe(false);
    expect(await verifySignature(secret, body, ts, sig, 2000)).toBe(false);
    expect(await verifySignature(secret, body, undefined, sig, 1000)).toBe(false);
  });

  it("hashes with sha256", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
