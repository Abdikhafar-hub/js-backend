import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";

describe("health endpoints", () => {
  it("registers the health route", () => {
    const app = createApp();
    const routes = app._router?.stack
      ?.filter((entry: { route?: { path?: string } }) => entry.route)
      .map((entry: { route?: { path?: string } }) => entry.route?.path);

    expect(routes).toContain("/health");
  });
});
