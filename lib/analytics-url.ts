// Keep navigation and campaign attribution; discard arbitrary query text.
export function analyticsUrl(value:string):string {
  const url=new URL(value);url.hash="";
  const allowed=new Set(["point","connection","signal","day","utm_source","utm_medium","utm_campaign","utm_content"]);
  for(const [key,value] of [...url.searchParams])if(!allowed.has(key) || !/^[\w:.-]{1,200}$/.test(value))url.searchParams.delete(key);
  return url.toString();
}
