export function summarizePublicRemarks(value: string | null | undefined, maxLength = 1000) {
  const remarks = value?.trim();
  if (!remarks) return undefined;
  if (remarks.length <= maxLength) return remarks;
  const available = Math.max(1, maxLength - 1);
  const candidate = remarks.slice(0, available);
  const lastWhitespace = candidate.search(/\s+\S*$/);
  const summary = (lastWhitespace > available * 0.6 ? candidate.slice(0, lastWhitespace) : candidate)
    .trimEnd();
  return `${summary}…`;
}
