import { describe, expect, it } from "vitest";
import { checkUpload, sanitizeFileName, typeForFileName } from "../src/files.js";
import { SubmitJobBody } from "../src/schemas.js";
import { canTransition } from "../src/status.js";
import { formatToken } from "../src/token.js";

describe("formatToken", () => {
  it("counts A1..A99 then B1", () => {
    expect(formatToken(1)).toBe("A1");
    expect(formatToken(99)).toBe("A99");
    expect(formatToken(100)).toBe("B1");
    expect(formatToken(26 * 99)).toBe("Z99");
    expect(formatToken(26 * 99 + 1)).toBe("A1");
  });
});

describe("files", () => {
  it("detects types by extension", () => {
    expect(typeForFileName("Resume.PDF")?.kind).toBe("pdf");
    expect(typeForFileName("photo.jpeg")?.ext).toBe("jpg");
    expect(typeForFileName("deck.pptx")?.kind).toBe("office");
    expect(typeForFileName("virus.exe")).toBeUndefined();
  });

  it("checks size and type", () => {
    expect(checkUpload("a.pdf", 1000).ok).toBe(true);
    expect(checkUpload("a.pdf", 0).ok).toBe(false);
    expect(checkUpload("a.pdf", 26 * 1024 * 1024).ok).toBe(false);
    expect(checkUpload("a.zip", 10).ok).toBe(false);
  });

  it("sanitizes names", () => {
    expect(sanitizeFileName("C:\\Users\\x\\My<File>.pdf")).toBe("MyFile.pdf");
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("a".repeat(300) + ".docx").length).toBeLessThanOrEqual(120);
  });
});

describe("status machine", () => {
  it("allows the happy path and blocks skipping the build", () => {
    expect(canTransition("draft", "building")).toBe(true);
    expect(canTransition("building", "new")).toBe(true);
    expect(canTransition("new", "opened")).toBe(true);
    expect(canTransition("ready", "done")).toBe(true);
    expect(canTransition("draft", "new")).toBe(false);
    expect(canTransition("expired", "new")).toBe(false);
  });
});

describe("SubmitJobBody", () => {
  it("validates a well-formed body", () => {
    const r = SubmitJobBody.safeParse({
      customerName: "  Ravi ",
      files: [
        {
          fileId: "5f8e2a3c-1d2b-4c5d-8e9f-0a1b2c3d4e5f",
          position: 0,
          pageSequence: [1, 2],
          colorPages: [],
          copies: 1,
          sides: "single",
          paperSize: "A4",
        },
      ],
      clientTotalPaise: 400,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.customerName).toBe("Ravi");
  });

  it("rejects an empty name", () => {
    const r = SubmitJobBody.safeParse({ customerName: " ", files: [], clientTotalPaise: 0 });
    expect(r.success).toBe(false);
  });
});
