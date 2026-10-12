import {parse, type DefaultTreeAdapterMap} from "parse5";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];
const ignoredTags = new Set(["script","style","nav","header","footer","aside","form","button","noscript","template","svg","figcaption"]);
const blockTags = new Set(["p","div","section","article","main","li","h1","h2","h3","h4","blockquote","tr","br"]);
function attribute(node: Element, name: string): string {return node.attrs.find(attr=>attr.name===name)?.value ?? "";}
function ignored(node: Element): boolean {
 const identity=`${attribute(node,"id")} ${attribute(node,"class")}`.split(/\s+/).filter(token=>!/^category-|^tag-/.test(token)).join(" ");
 return ignoredTags.has(node.tagName) || attribute(node,"aria-hidden")==="true" || node.attrs.some(attr=>attr.name==="hidden")
  || /^(?:navigation|banner|contentinfo|complementary)$/.test(attribute(node,"role"))
  || /(?:^|[\s_-])(?:share|sharing|social|breadcrumb|related|newsletter|advertisement|advert|cookie|comment|comments|post-meta)(?:$|[\s_-])/i.test(identity);
}
function textOf(node: Node): string {
 if (node.nodeName==="#text" && "value" in node) return node.value;
 if ("tagName" in node && ignored(node)) return "";
 if (!("childNodes" in node)) return "";
 const content=node.childNodes.map(textOf).join("");
 return "tagName" in node && blockTags.has(node.tagName) ? `\n${content}\n` : content;
}
/** Keep article prose; navigation, controls and figure captions are not evidence. */
export function articleText(html: string): string {
 const document=parse(html);
 const bodies: Element[]=[];const articles: Element[]=[];const mains: Element[]=[];
 const visit=(node: Node)=>{
  if ("tagName" in node) {
   if(ignored(node))return;
   const classes=attribute(node,"class").split(/\s+/);
   if (attribute(node,"itemprop").split(/\s+/).includes("articleBody") || classes.some(value=>["td-post-content","entry-content","article-body","article-content","post-content","story-body"].includes(value))) bodies.push(node);
   if(node.tagName==="article")articles.push(node);
   if(node.tagName==="main")mains.push(node);
  }
  if("childNodes" in node)node.childNodes.forEach(visit);
 };
 visit(document);
 for(const group of [bodies,articles,mains]) {
  const candidates=group.map(textOf).map(text=>text.replace(/[\t\r ]+/g," ").replace(/ *\n */g,"\n").replace(/\n{3,}/g,"\n\n").trim()).filter(text=>text.length>=150);
  if(candidates.length)return candidates.sort((a,b)=>b.length-a.length)[0];
 }
 return "";
}
