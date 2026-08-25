import { describe, expect, it } from "vitest";
import { matchingAgentId } from "../../client/src/features/properties/agentSelection.js";

describe("OneKey listing agent selection regression", () => {
  const agents = [
    { id: "eric", displayName: "Eric Wei", isActive: true },
    { id: "si", displayName: "Si Zhang", isActive: true },
  ];

  it("matches the exact MLS listing agent without falling back to the first active agent", () => {
    expect(matchingAgentId("Si Zhang", agents)).toBe("si");
    expect(matchingAgentId("Yan Xue Zheng", agents)).toBe("");
    expect(matchingAgentId(undefined, agents)).toBe("");
  });
});
