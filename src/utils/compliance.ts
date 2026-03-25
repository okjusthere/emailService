import { config } from "../config.js";

/**
 * Generates CAN-SPAM compliant email headers
 */
export function getComplianceHeaders(unsubscribeUrl: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${unsubscribeUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

/**
 * Build the unsubscribe URL for a subscriber
 */
export function buildUnsubscribeUrl(token: string): string {
  return `${config.baseUrl}/unsubscribe?token=${token}`;
}

/**
 * Validate that an email draft has all required CAN-SPAM elements
 */
export function validateCompliance(html: string): {
  valid: boolean;
  issues: string[];
} {
  const issues: string[] = [];

  // Check physical address
  if (!html.includes(config.company.address)) {
    issues.push("Missing physical postal address");
  }

  // Check company name
  if (!html.includes(config.company.name)) {
    issues.push("Missing company/sender identification");
  }

  // Check unsubscribe link
  if (!html.includes("unsubscribe")) {
    issues.push("Missing unsubscribe mechanism");
  }

  // Check commercial message disclosure
  if (
    !html.toLowerCase().includes("commercial message") &&
    !html.toLowerCase().includes("advertisement")
  ) {
    issues.push("Missing advertisement/commercial message disclosure");
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}
