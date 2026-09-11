import { describe, expect, it } from "vitest";
import { listingCosts } from "../../src/integrations/onekey/listingCosts.js";
describe("Portal listing costs", () => {
  it("keeps explicit amounts and periods, including a real zero", () => {
    expect(
      listingCosts({
        taxAnnualAmount: 8000,
        monthlyMaintenanceFee: 375,
        associationFee: 0,
        associationFeeFrequency: "Monthly",
      })
    ).toEqual({
      annualPropertyTax: "$8,000",
      monthlyMaintenanceFee: "$375",
      associationFee: "$0",
      associationFeeFrequency: "Monthly",
    });
  });
  it("does not turn missing or ambiguous costs into zero or assume a monthly period", () => {
    expect(
      listingCosts({
        taxAnnualAmount: null,
        maintenanceFee: 375,
        associationFee: 100,
        associationFeeFrequency: "Unknown",
      })
    ).toEqual({
      annualPropertyTax: undefined,
      monthlyMaintenanceFee: undefined,
      associationFee: "$100",
      associationFeeFrequency: undefined,
    });
    expect(listingCosts({ taxAnnualAmount: ",," }).annualPropertyTax).toBeUndefined();
  });
});
