import { afterEach, describe, expect, it, vi } from "vitest";
import { validatePosterHighlights } from "../../src/integrations/ai/posterHighlights.js";
import { OpenAiCopyProvider } from "../../src/integrations/ai/OpenAiCopyProvider.js";
const facts = {
  address: "555 Example Avenue",
  description:
    "Newly renovated apt with a huge private deck; tax as low as 8K per year; management fee is 375 per month.",
};
const result = {
  highlights: [{ en: "Huge private deck", zh: "超大私人露台", evidence: "huge private deck" }],
  financialFacts: [
    {
      kind: "property_tax",
      en: "Property tax from $8,000/year",
      zh: "地税低至 $8,000/年",
      evidence: "tax as low as 8K per year",
    },
  ],
};
afterEach(() => vi.unstubAllGlobals());
describe("Evidence-based poster selling points", () => {
  it("keeps separate selling points and qualified financial facts with real source evidence", () => {
    expect(validatePosterHighlights(result, facts)).toEqual(result);
  });
  it("rejects invented evidence and changed amounts", () => {
    expect(() =>
      validatePosterHighlights(
        {
          ...result,
          highlights: [{ ...result.highlights[0], evidence: "Swimming pool and ocean view" }],
        },
        facts
      )
    ).toThrow(/source excerpt/);
    expect(() =>
      validatePosterHighlights(
        { ...result, financialFacts: [{ ...result.financialFacts[0], en: "Tax $6,000/year" }] },
        facts
      )
    ).toThrow(/numeric value/);
  });
  it("uses the configured Azure text model and a dedicated extraction schema", async () => {
    const request = vi.fn(async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body.model).toBe("text-test");
      expect(body.store).toBe(false);
      expect(body.instructions).toContain("not paragraph compression");
      expect(body.text.format.name).toBe("poster_highlights");
      expect(init.headers).toHaveProperty("api-key", "test-key");
      return Response.json({ output_text: JSON.stringify(result) });
    });
    vi.stubGlobal("fetch", request);
    const provider = new OpenAiCopyProvider("test-key", "text-test", 1000, {
      baseUrl: "https://test.openai.azure.com/openai/v1",
      authMode: "api-key",
    });
    expect(await provider.extractPosterHighlights(facts)).toEqual(result);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
