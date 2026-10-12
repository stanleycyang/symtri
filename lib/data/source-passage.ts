const normalize=(text:string)=>text.replace(/\s+/g," ").trim();
/** A run of UI labels, not a sentence mentioning a social platform. */
export function hasExcerptChrome(text: string): boolean {
 return /(?:\b(?:Facebook|Twitter|X|Pinterest|LinkedIn|Reddit|WhatsApp|Telegram|Email|Print|Copy(?:\s+(?:URL|link))?)\b[\s|·]*){3,}/i.test(text)
  || /^(?:Share (?:this|the) (?:article|story)|(?:Print\s+)?Copy (?:URL|link))\b/i.test(text.trim())
  || /^[\w]+(?:-[\w]+){3,}(?:\s|$)/.test(text.trim()) && (text.trim().split(/\s/,1)[0]?.length ?? 0)>35;
}
/** Return an exact, contiguous source passage, never reconstructed prose. */
export function sourcePassage(source: string, title: string, kind: string): string | null {
 const text=normalize(source);
 const overview=kind==="repository" ? /(?:^|\s)#{1,3}\s+(?:[^\w\s]+\s*)?(?:Project\s+)?(?:Overview|Introduction|About)\s+/i.exec(text) : null;
 const titleAt=text.toLowerCase().indexOf(normalize(title).toLowerCase());
 const body=overview && text.length-overview.index-overview[0].length>=100 ? text.slice(overview.index+overview[0].length)
  : titleAt>0 && titleAt<2000 && /\s/.test(text[titleAt-1]) && text.length-titleAt>=100 ? text.slice(titleAt) : text;
 const starts=[0,...[...body.slice(0,8000).matchAll(/(?:^|\s)#{1,3}\s+|\b(?:The|This|It|We|A|An|[A-Z][a-z]{2,})\s/g)].map(match=>match.index!)].slice(0,100);
 for(const start of starts) {
  if(start>0 && !/\s/.test(body[start-1]) && !/\s/.test(body[start]))continue;
  const candidate=body.slice(start).trim();
  const sentence=candidate.match(/^.{99,229}?[.!?。！？](?=\s|$)/u)?.[0];
  const words:string[]=[];
  if(!sentence)for(const word of candidate.split(" ")) {if(words.length>=40 || [...words,word].join(" ").length>230)break;words.push(word);}
  const passage=sentence ?? words.join(" ");
  const prose=passage.replace(/https?:\/\/\S+/g,"").replace(/[#[\]()*`|>]/g," ");
  if(passage.length<100 || hasExcerptChrome(passage)
   || (prose.split(/\s+/).filter(word=>word.length>1).length<12 && (prose.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu)?.length ?? 0)<60)
   || /!\[|badge\.svg|shields\.io|actions\/workflows|[a-z0-9_/.:-]{70,}/i.test(passage))continue;
  return passage;
 }
 return null;
}
