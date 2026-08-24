import { afterEach, describe, expect, it, vi } from "vitest";
import { parseEnv } from "../../src/config/env.js";
import { OpenAiCopyProvider } from "../../src/integrations/ai/OpenAiCopyProvider.js";

afterEach(() => vi.unstubAllGlobals());

describe("Azure OpenAI production adapter regression", () => {
  it("uses the Azure v1 endpoint and api-key header", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("https://homix.openai.azure.com/openai/v1/responses");
      expect(init?.headers).toMatchObject({ "api-key": "azure-test-key" });
      expect(init?.headers).not.toHaveProperty("Authorization");
      return new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            title: "AI title",
            shortDescription: "AI short description",
            longDescription: "AI long description",
            highlights: ["Verified highlight"],
          }),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiCopyProvider("azure-test-key", "gpt-5.6-terra", 1000, {
      baseUrl: "https://homix.openai.azure.com/openai/v1/",
      authMode: "api-key",
    });

    await expect(
      provider.generateListing({ tone: "professional", facts: { address: "Verified address" } })
    ).resolves.toMatchObject({ title: "AI title" });
  });

  it("rejects non-Azure endpoints before a production Azure key can be sent", () => {
    expect(() =>
      parseEnv({
        DATABASE_URL: "postgresql://test/test?sslmode=require",
        DIRECT_DATABASE_URL: "postgresql://test/test?sslmode=require",
        AI_PROVIDER: "azure-openai",
        OPENAI_API_KEY: "azure-test-key",
        OPENAI_BASE_URL: "https://attacker.example/openai/v1",
      })
    ).toThrow(/Azure OpenAI requires/);
  });
});
