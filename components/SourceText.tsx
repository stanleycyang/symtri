import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { presentationText, sourceLink } from "@/lib/data/note-presentation";

export default function SourceText({text,baseUrl}:{text:string;baseUrl?:string}) {
  return <div className="source-text" dir="auto"><Markdown skipHtml remarkPlugins={[remarkGfm]}
    urlTransform={href=>sourceLink(href,baseUrl) ?? ""}
    disallowedElements={["img", "input"]}
    components={{
      a:({href,children})=>href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
      h1:({children})=><p>{children}</p>,h2:({children})=><p>{children}</p>,h3:({children})=><p>{children}</p>,
      table:({children})=><div className="source-table"><table>{children}</table></div>,
    }}>{presentationText(text)}</Markdown></div>;
}
