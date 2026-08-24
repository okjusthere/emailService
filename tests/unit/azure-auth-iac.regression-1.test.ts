import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Azure Easy Auth custom-domain mutations", () => {
  it("trusts the configured application base URL for authenticated browser flows", () => {
    const template = readFileSync("infra/main.bicep", "utf8");
    expect(template).toContain("allowedExternalRedirectUrls: [baseUrl]");
  });
});
