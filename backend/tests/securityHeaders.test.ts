import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";

import { securityHeaders } from "../src/middleware/securityHeaders";

const app = express().use(securityHeaders);
app.get("/probe", (_req, res) => res.json({ ok: true }));

describe("cross-origin isolation & permissions headers", () => {
  it("sets COOP, COEP and Permissions-Policy on every response", async () => {
    const response = await request(app).get("/probe");

    expect(response.status).toBe(200);
    expect(response.headers["cross-origin-opener-policy"]).toBe("same-origin");
    expect(response.headers["cross-origin-embedder-policy"]).toBe("require-corp");
    expect(response.headers["permissions-policy"]).toBeDefined();
  });

  it("disables sensitive browser features via Permissions-Policy", async () => {
    const response = await request(app).get("/probe");
    const policy = String(response.headers["permissions-policy"] ?? "");

    for (const feature of [
      "camera",
      "microphone",
      "geolocation",
      "payment",
      "usb",
    ]) {
      expect(policy).toContain(`${feature}=()`);
    }
  });
});
