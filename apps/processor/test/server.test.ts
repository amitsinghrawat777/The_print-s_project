import { describe, expect, it, vi } from "vitest";
import { signBody } from "@print/shared";
import type { Deps } from "../src/jobs.js";
import { WorkQueue } from "../src/queue.js";
import { buildServer } from "../src/server.js";

vi.mock("../src/jobs.js", () => ({
  processFile: vi.fn(async () => {}),
  buildJob: vi.fn(async () => {}),
  cleanup: vi.fn(async () => ({ expired: 0, purged: 0 })),
}));

const secret = "0123456789abcdef-test";

function makeApp() {
  const queue = new WorkQueue(1, () => {});
  const app = buildServer({
    secret,
    logLevel: "silent",
    makeDeps: (log) => ({ log }) as unknown as Deps,
    queue,
  });
  return { app, queue };
}

describe("processor HTTP API", () => {
  it("serves health without a signature", async () => {
    const { app } = makeApp();
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
  });

  it("rejects unsigned and wrongly signed requests", async () => {
    const { app } = makeApp();
    const payload = JSON.stringify({ fileId: "5f8e2a3c-1d2b-4c5d-8e9f-0a1b2c3d4e5f" });
    const unsigned = await app.inject({
      method: "POST",
      url: "/process-file",
      payload,
      headers: { "content-type": "application/json" },
    });
    expect(unsigned.statusCode).toBe(401);

    const headers = await signBody("wrong-secret-xxxxxxxx", payload);
    const wrong = await app.inject({
      method: "POST",
      url: "/process-file",
      payload,
      headers: { ...headers, "content-type": "application/json" },
    });
    expect(wrong.statusCode).toBe(401);
  });

  it("queues signed work and validates bodies", async () => {
    const { app, queue } = makeApp();
    const { processFile } = await import("../src/jobs.js");
    const payload = JSON.stringify({ fileId: "5f8e2a3c-1d2b-4c5d-8e9f-0a1b2c3d4e5f" });
    const res = await app.inject({
      method: "POST",
      url: "/process-file",
      payload,
      headers: { ...(await signBody(secret, payload)), "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(202);
    await queue.onIdle();
    expect(processFile).toHaveBeenCalledTimes(1);

    const bad = JSON.stringify({ fileId: "nope" });
    const res2 = await app.inject({
      method: "POST",
      url: "/build-job",
      payload: bad,
      headers: { ...(await signBody(secret, bad)), "content-type": "application/json" },
    });
    expect(res2.statusCode).toBe(400);
  });
});

describe("WorkQueue", () => {
  it("dedupes keys and respects concurrency", async () => {
    let running = 0;
    let peak = 0;
    const q = new WorkQueue(2, () => {});
    const task = () => async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 10));
      running--;
    };
    expect(q.push("a", task())).toBe(true);
    expect(q.push("a", task())).toBe(false);
    q.push("b", task());
    q.push("c", task());
    await q.onIdle();
    expect(peak).toBe(2);
    expect(q.push("a", task())).toBe(true);
    await q.onIdle();
  });
});
