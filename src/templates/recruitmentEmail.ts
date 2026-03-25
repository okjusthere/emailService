import { config } from "../config.js";

/**
 * Generate the HTML email body with CAN-SPAM compliant footer.
 * This template is for recruitment purposes.
 */
export function buildRecruitmentEmail(params: {
  recipientName?: string;
  subject: string;
  bodyHtml: string;
  unsubscribeUrl: string;
}): string {
  const { recipientName, bodyHtml, unsubscribeUrl } = params;
  const greeting = recipientName ? `Hi ${recipientName},` : "Hi,";

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${params.subject}</title>
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f5f5f5; }
    .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; }
    .header { background-color: #1a365d; padding: 24px 32px; text-align: center; }
    .header h1 { color: #ffffff; margin: 0; font-size: 22px; font-weight: 600; }
    .content { padding: 32px; line-height: 1.6; color: #333333; font-size: 15px; }
    .footer { padding: 24px 32px; background-color: #f8f9fa; border-top: 1px solid #e2e8f0; text-align: center; font-size: 12px; color: #718096; line-height: 1.8; }
    .footer a { color: #4a6fa5; text-decoration: underline; }
    .unsubscribe { margin-top: 12px; }
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
      <p>This is a commercial message from <strong>${config.company.name}</strong></p>
      <p>${config.company.address}</p>
      <div class="unsubscribe">
        <p>
          You're receiving this email because you're in our recruitment network.<br>
          If you no longer wish to receive these emails,
          <a href="${unsubscribeUrl}">click here to unsubscribe</a>.
        </p>
      </div>
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
    `This is a commercial message from ${config.company.name}`,
    config.company.address,
    "",
    `To unsubscribe: ${params.unsubscribeUrl}`,
  ].join("\n");
}
