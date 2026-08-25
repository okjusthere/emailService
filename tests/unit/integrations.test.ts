import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeAiProvider } from "../../src/integrations/ai/FakeAiProvider.js";
import { OpenAiCopyProvider } from "../../src/integrations/ai/OpenAiCopyProvider.js";
import { BboOneKeyProvider } from "../../src/integrations/onekey/BboOneKeyProvider.js";
import {
  normalizeAddress,
  normalizeOneKeyListing,
} from "../../src/integrations/onekey/normalize.js";
import { isAllowedOneKeyMediaUrl } from "../../src/integrations/onekey/mediaPolicy.js";

afterEach(() => vi.unstubAllGlobals());

describe("OneKey provider boundary", () => {
  it("allows only explicitly configured BBO media origins in production", () => {
    const policy = {
      nodeEnv: "production" as const,
      provider: "bbo" as const,
      bboListingApiBaseUrl: "https://onekey.kevv.ai/api/v1",
      allowedOrigins: ["https://onekeymls.kevv.ai"],
    };
    expect(isAllowedOneKeyMediaUrl("https://onekey.kevv.ai/media/1.jpg", policy)).toBe(true);
    expect(isAllowedOneKeyMediaUrl("https://onekeymls.kevv.ai/media/1.jpg", policy)).toBe(true);
    expect(isAllowedOneKeyMediaUrl("https://onekeymls.kevv.ai.evil.test/media/1.jpg", policy)).toBe(
      false
    );
    expect(isAllowedOneKeyMediaUrl("http://onekeymls.kevv.ai/media/1.jpg", policy)).toBe(false);
    expect(isAllowedOneKeyMediaUrl("javascript:alert(1)", policy)).toBe(false);
  });

  it("normalizes BBO listing DTOs and stable address text", () => {
    expect(normalizeAddress("136-20 Roosevelt Avenue, Flushing, NY")).toBe(
      "136 20 roosevelt ave flushing ny"
    );
    expect(
      normalizeOneKeyListing({
        listingKey: "KEY900000001",
        listingId: "90000001",
        unparsedAddress: "136-20 Roosevelt Ave, Flushing, NY 11354",
        city: "Flushing",
        stateOrProvince: "New York",
        postalCode: "11354",
        listAgentFullName: "Si Zhang",
        listPrice: 1_250_000,
        imageUrls: ["https://onekey.example.test/media/1.jpg"],
      })
    ).toMatchObject({
      sourceKey: "KEY900000001",
      stateCode: "NY",
      listAgentFullName: "Si Zhang",
      listPrice: 1_250_000,
      imageUrls: ["https://onekey.example.test/media/1.jpg"],
    });
    expect(() =>
      normalizeOneKeyListing({
        listingKey: "KEY_BAD",
        unparsedAddress: "Bad fixture",
        city: "Flushing",
        stateOrProvince: "NY",
        postalCode: "11354",
        imageUrls: ["javascript:alert(1)"],
      })
    ).toThrow();
  });

  it("calls only the bounded BBO read contract and sanitizes provider failures", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toContain("/listings/search?");
      expect(init?.headers).toMatchObject({ Authorization: "Bearer bbo-test-key" });
      return new Response(
        JSON.stringify({
          items: [
            {
              listingKey: "KEY900000001",
              unparsedAddress: "136-20 Roosevelt Ave, Flushing, NY 11354",
              city: "Flushing",
              stateOrProvince: "NY",
              postalCode: "11354",
              imageUrls: [],
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new BboOneKeyProvider("https://bbo.example.test/api/v1", "bbo-test-key", 1000);
    await expect(
      provider.search({ query: "90000001", limit: 20, offset: 0 })
    ).resolves.toMatchObject([{ sourceKey: "KEY900000001" }]);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("upstream leaked detail", { status: 500 }))
    );
    await expect(provider.testConnection()).rejects.toMatchObject({
      code: "ONEKEY_PROVIDER_UNAVAILABLE",
      message: "The BBO listing-data service is temporarily unavailable.",
    });
  });

  it("loads only the listing-scoped BBO Agent contact contract", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe(
        "https://bbo.example.test/api/v1/marketing/listings/KEY900000001/agent"
      );
      return new Response(
        JSON.stringify({
          listingKey: "KEY900000001",
          agent: {
            memberKey: "MEMBER1",
            memberMlsId: "12345",
            fullName: "Si Zhang",
            firstName: "Si",
            lastName: "Zhang",
            email: "si.zhang@example.com",
            phone: "718-555-0101",
            stateLicense: "10401399999",
            status: "Active",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new BboOneKeyProvider("https://bbo.example.test/api/v1", "bbo-test-key", 1000);
    await expect(provider.getListingAgent("KEY900000001")).resolves.toMatchObject({
      memberKey: "MEMBER1",
      fullName: "Si Zhang",
      email: "si.zhang@example.com",
      phone: "718-555-0101",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("AI provider boundary", () => {
  it("keeps fake generation deterministic and returns three campaign variants", async () => {
    const provider = new FakeAiProvider();
    await expect(
      provider.generateListing({
        tone: "professional",
        facts: { address: "136-20 Roosevelt Ave", bedroomsTotal: 4 },
      })
    ).resolves.toMatchObject({
      title: expect.stringContaining("136-20 Roosevelt Ave"),
      highlights: expect.arrayContaining(["4 bedrooms"]),
    });
    const campaign = await provider.generateCampaign({
      tone: "warm",
      facts: { address: "136-20 Roosevelt Ave", city: "Flushing" },
      current: {},
    });
    expect(campaign.variants).toHaveLength(3);
    expect(campaign.recommendedIndex).toBe(0);
  });

  it("uses Responses structured output without storing the provider request", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({ model: "gpt-test", store: false });
      expect(body.text).toMatchObject({
        format: { type: "json_schema", name: "listing_copy_proposal", strict: true },
      });
      expect(String(body.instructions)).toContain("untrusted source");
      return new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            title: "Verified title",
            shortDescription: "Verified short description",
            longDescription: "Verified long description",
            highlights: ["Verified fact"],
          }),
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiCopyProvider("test-key", "gpt-test", 1000);
    await expect(
      provider.generateListing({ tone: "concise", facts: { address: "Verified address" } })
    ).resolves.toMatchObject({ title: "Verified title" });
  });
});
