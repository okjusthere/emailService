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

const ASSET_IMAGE_STYLES: Record<string, string> = {
  display: "block",
  width: "100%",
  "max-width": "560px",
  height: "auto",
  margin: "16px auto",
  border: "0",
  "border-radius": "12px",
  outline: "none",
  "text-decoration": "none",
};

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

  html = normalizeEmailImages(html);

  return html;
}

function normalizeEmailImages(html: string): string {
  return html.replace(/<img\b([^>]*)>/gi, (match, rawAttrs: string) => {
    const src = getAttributeValue(rawAttrs, "src");

    if (!src || !/\{\{asset:[a-z0-9-]+\}\}/i.test(src)) {
      return match;
    }

    let attrs = rawAttrs;
    attrs = setAttributeValue(attrs, "width", "560");
    attrs = setAttributeValue(
      attrs,
      "style",
      serializeStyle({
        ...parseStyle(getAttributeValue(attrs, "style") || ""),
        ...ASSET_IMAGE_STYLES,
      })
    );

    return `<img${attrs}>`;
  });
}

function getAttributeValue(attrs: string, name: string): string | null {
  const pattern = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = attrs.match(pattern);
  return match ? match[2] || match[3] || match[4] || "" : null;
}

function setAttributeValue(attrs: string, name: string, value: string): string {
  const escapedValue = value.replace(/"/g, "&quot;");
  const pattern = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");

  if (pattern.test(attrs)) {
    return attrs.replace(pattern, ` ${name}="${escapedValue}"`);
  }

  return `${attrs} ${name}="${escapedValue}"`;
}

function parseStyle(style: string): Record<string, string> {
  const declarations: Record<string, string> = {};

  for (const declaration of style.split(";")) {
    const separatorIndex = declaration.indexOf(":");
    if (separatorIndex === -1) continue;

    const property = declaration.slice(0, separatorIndex).trim().toLowerCase();
    const value = declaration.slice(separatorIndex + 1).trim();
    if (property && value) declarations[property] = value;
  }

  return declarations;
}

function serializeStyle(style: Record<string, string>): string {
  return Object.entries(style)
    .map(([property, value]) => `${property}:${value}`)
    .join(";");
}
