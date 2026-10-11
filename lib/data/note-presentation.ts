/** Presentation only: retained evidence and exact quotations are never rewritten. */
export function presentationText(text: string): string {
  return text
    .replace(/^---\s*\n[\s\S]*?\n---\s*\n/, "")
    .replace(/\[!\[[^\]]*$/, "")
    .replace(/\]\((?:https?:\/\/|\.{0,2}\/)[^)]*$/, "]")
    .trim();
}
export function sourceLink(href: string, base?: string): string | undefined {
  try {
    const url = base ? new URL(href, base) : new URL(href);
    return ["https:", "http:"].includes(url.protocol) ? url.href : undefined;
  } catch { return undefined; }
}
export function extractivePassage(text: string): string | null {
  return /^The (?:source|discussion) states: “([\s\S]*)”$/.exec(text)?.[1] ?? null;
}

export function excerptDisplay(text:string):string {
  return /[.!?…][”"’\')\]]?$/.test(text.trim()) ? text : `${text}…`;
}
