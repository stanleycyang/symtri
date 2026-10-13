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
    // Resolve relative links only when the source identifies an actual document,
    // not a repository landing page with an unknown branch or file route.
    if(base && !/^https?:\/\//i.test(href)) {
      const path=new URL(base).pathname;
      if(!/\.[a-z0-9]{1,8}$/i.test(path) && !path.endsWith("/")) return undefined;
    }
    const url = base ? new URL(href, base) : new URL(href);
    return ["https:", "http:"].includes(url.protocol) ? url.href : undefined;
  } catch { return undefined; }
}
export function extractivePassage(text: string): string | null {
  return /^The (?:source|discussion) states: “([\s\S]*)”$/.exec(text)?.[1] ?? null;
}

export function excerptDisplay(text:string):string {
  const display=text.trim().replace(/\s+([.!?…。！？][”"’')\]]?)$/, "$1");
  return /[.!?…。！？][”"’')\]]?$/.test(display) ? display : `${display}…`;
}
