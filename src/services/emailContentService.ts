import fs from "fs";
import path from "path";
import {
  normalizePlainText,
  normalizeSubject,
  sanitizeEmailHtml,
} from "../utils/emailHtml.js";

export interface EmailContent {
  subject: string;
  bodyHtml: string;
  bodyText: string;
}

const CONTENT_PATH = path.join(process.cwd(), "data", "email_content.json");

const DEFAULT_EMAIL_CONTENT: EmailContent = {
  subject: "Join Us — Grow Your Real Estate Career",
  bodyHtml: `
    <p>We're looking for talented and driven real estate professionals to join our growing team.</p>
    <p><strong>Why Us?</strong></p>
    <ul>
      <li>Competitive commission splits</li>
      <li>Comprehensive training and mentorship</li>
      <li>Advanced technology and marketing support</li>
      <li>A collaborative, growth-oriented culture</li>
    </ul>
    <p>Interested? Reply to this email to learn more.</p>
    <p>Best regards,<br><strong>The Recruiting Team</strong></p>`,
  bodyText: `We're looking for talented and driven real estate professionals to join our growing team.

Why Us?
- Competitive commission splits
- Comprehensive training and mentorship
- Advanced technology and marketing support
- A collaborative, growth-oriented culture

Interested? Reply to this email to learn more.

Best regards,
The Recruiting Team`,
};

export function normalizeEmailContent(content: EmailContent): EmailContent {
  return {
    subject: normalizeSubject(content.subject),
    bodyHtml: sanitizeEmailHtml(content.bodyHtml),
    bodyText: normalizePlainText(content.bodyText),
  };
}

export function getDefaultEmailContent(): EmailContent {
  return normalizeEmailContent(DEFAULT_EMAIL_CONTENT);
}

export function getEmailContent(): EmailContent {
  try {
    if (fs.existsSync(CONTENT_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(CONTENT_PATH, "utf-8"));
      return normalizeEmailContent(parsed);
    }
  } catch {
    return getDefaultEmailContent();
  }

  return getDefaultEmailContent();
}

export function saveEmailContent(content: EmailContent): EmailContent {
  const normalized = normalizeEmailContent(content);
  const dir = path.dirname(CONTENT_PATH);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(CONTENT_PATH, JSON.stringify(normalized, null, 2));
  return normalized;
}
