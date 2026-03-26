import { config } from "../config.js";

/**
 * Email template mode:
 * - "personal": Minimal HTML, looks like a 1-on-1 email → lands in Primary inbox
 * - "branded": Styled newsletter with header/footer → likely lands in Promotions
 */
export type TemplateMode = "personal" | "branded";

export function getDefaultTemplateMode(): TemplateMode {
  return config.emailTemplateMode;
}

export function resolveTemplateMode(
  value: unknown,
  fallback: TemplateMode = getDefaultTemplateMode()
): TemplateMode {
  return value === "branded" || value === "personal" ? value : fallback;
}

/**
 * Generate HTML email body.
 * "personal" mode uses minimal HTML to mimic a real human-sent email.
 * "branded" mode uses a styled newsletter layout.
 */
export function buildRecruitmentEmail(params: {
  recipientName?: string;
  subject: string;
  bodyHtml: string;
  unsubscribeUrl: string;
  templateMode?: TemplateMode;
}): string {
  const { recipientName, bodyHtml, unsubscribeUrl } = params;
  const greeting = recipientName ? `Hi ${recipientName},` : "Hi,";
  const templateMode = resolveTemplateMode(
    params.templateMode,
    getDefaultTemplateMode()
  );

  if (templateMode === "personal") {
    return buildPersonalEmail(greeting, bodyHtml, unsubscribeUrl);
  }
  return buildBrandedEmail(greeting, params.subject, bodyHtml, unsubscribeUrl);
}

/**
 * Personal mode: Minimal HTML that looks like a real email from a person.
 * Gmail key signals for Primary: simple HTML, no heavy styling, no marketing layout.
 */
function buildPersonalEmail(
  greeting: string,
  bodyHtml: string,
  unsubscribeUrl: string
): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;color:#222;line-height:1.6;margin:0;padding:20px;">
<p>${greeting}</p>
${bodyHtml}
<p style="margin-top:32px;font-size:12px;color:#999;">
${config.company.name} · ${config.company.address}<br>
<a href="${unsubscribeUrl}" style="color:#999;">Unsubscribe</a>
</p>
</body>
</html>`.trim();
}

/**
 * Branded mode: Newsletter-style with header/footer (original template).
 */
function buildBrandedEmail(
  greeting: string,
  subject: string,
  bodyHtml: string,
  unsubscribeUrl: string
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f5f5f5; }
    .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; }
    .header { background-color: #1a365d; padding: 24px 32px; text-align: center; }
    .header h1 { color: #ffffff; margin: 0; font-size: 22px; font-weight: 600; }
    .content { padding: 32px; line-height: 1.6; color: #333333; font-size: 15px; }
    .footer { padding: 24px 32px; background-color: #f8f9fa; border-top: 1px solid #e2e8f0; text-align: center; font-size: 12px; color: #718096; line-height: 1.8; }
    .footer a { color: #4a6fa5; text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${config.company.name}</h1>
    </div>
    <div class="content">
      <p>${greeting}</p>
      ${bodyHtml}
    </div>
    <div class="footer">
      <p>${config.company.name} · ${config.company.address}</p>
      <p><a href="${unsubscribeUrl}">Unsubscribe</a></p>
    </div>
  </div>
</body>
</html>`.trim();
}

/**
 * Generate a plain-text version of the email (CAN-SPAM best practice)
 */
export function buildPlainText(params: {
  recipientName?: string;
  bodyText: string;
  unsubscribeUrl: string;
}): string {
  const greeting = params.recipientName
    ? `Hi ${params.recipientName},`
    : "Hi,";

  return [
    greeting,
    "",
    params.bodyText,
    "",
    "---",
    `${config.company.name} · ${config.company.address}`,
    "",
    `Unsubscribe: ${params.unsubscribeUrl}`,
  ].join("\n");
}
