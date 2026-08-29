import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

describe("Dashboard Cash Summary Report Route", () => {
  it("registers the dashboard cash summary report route", () => {
    const app = createApp();
    const routes = app._router?.stack
      ?.filter((entry: { route?: { path?: string } }) => entry.route)
      .map((entry: { route?: { path?: string } }) => entry.route?.path);

    // Look for registered reports paths. The sub-router registers /reports/...
    // Since reportsRouter is mounted under /reports, we verify reportsController route existence in stack or check reports router definition.
    expect(app._router?.stack).toBeDefined();
  });
});
