import {parseShareView} from "@/lib/seo/share";
import {viewMetadata} from "@/lib/seo/views";
import dynamic from "next/dynamic";
import KnowledgeDirectory from "@/components/KnowledgeDirectory";
const Experience = dynamic(() => import("@/components/Experience"));
export async function generateMetadata({searchParams}: {searchParams: Promise<Record<string,string | string[] | undefined>>}) {
  const values=await searchParams;
  const params=new URLSearchParams();
  for(const key of ["point","connection","signal","day"])if(typeof values[key]==="string")params.set(key,values[key]);
  return viewMetadata(parseShareView(params));
}
export default function Home() {return <><a className="skip-link" href="#browse-knowledge">Skip the map and browse subjects</a><main><Experience /><KnowledgeDirectory /></main></>;}
