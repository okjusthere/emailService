const BLOCKED_TAGS = [
  "script",
  "iframe",
  "object",
  "embed",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "option",
  "meta",
  "base",
  "link",
  "svg",
  "math",
];

export function normalizeSubject(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizePlainText(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}

export function sanitizeEmailHtml(value: string): string {
  let html = value.replace(/\r\n?/g, "\n").trim();

  for (const tag of BLOCKED_TAGS) {
    const pairedTagPattern = new RegExp(
      `<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`,
      "gi"
    );
    const singleTagPattern = new RegExp(`<${tag}\\b[^>]*\\/?>`, "gi");
    html = html.replace(pairedTagPattern, "");
    html = html.replace(singleTagPattern, "");
  }

  html = html.replace(/\son[a-z-]+\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, "");
  html = html.replace(
    /\s(href|src)\s*=\s*(['"])\s*(?:javascript:|vbscript:|data:text\/html)[\s\S]*?\2/gi,
    ""
  );
  html = html.replace(
    /\sstyle\s*=\s*(".*?expression\s*\(.*?\).*?"|'.*?expression\s*\(.*?\).*?'|[^\s>]+)/gi,
    ""
  );

  return html;
}

