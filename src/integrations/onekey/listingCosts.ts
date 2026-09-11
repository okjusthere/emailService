// Forward only explicit, structured costs. Missing data remains missing.
export function listingCosts(value: unknown) {
  const raw =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const amount = (...keys: string[]) => {
    for (const key of keys) {
      const value = raw[key];
      const n =
        typeof value === "number"
          ? value
          : typeof value === "string" &&
              /^(?:\d+(?:\.\d+)?|\d{1,3}(?:,\d{3})+(?:\.\d+)?)$/.test(value.trim())
            ? Number(value.replace(/,/g, ""))
            : NaN;
      if (Number.isFinite(n) && n >= 0)
        return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
    }
    return undefined;
  };
  const frequency = raw.associationFeeFrequency ?? raw.AssociationFeeFrequency;
  const periods: Record<string, string> = {
    monthly: "Monthly",
    quarterly: "Quarterly",
    annually: "Annually",
    annual: "Annually",
    yearly: "Annually",
  };
  return {
    annualPropertyTax: amount("taxAnnualAmount", "TaxAnnualAmount", "annualTaxes", "AnnualTaxes"),
    monthlyMaintenanceFee: amount(
      "monthlyMaintenanceFee",
      "MonthlyMaintenanceFee",
      "monthlyCommonCharges",
      "MonthlyCommonCharges"
    ),
    associationFee: amount("associationFee", "AssociationFee"),
    associationFeeFrequency:
      typeof frequency === "string" ? periods[frequency.toLowerCase()] : undefined,
  };
}
