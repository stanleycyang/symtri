import {getUniverseCatalog} from "@/lib/data/catalog";
import {pointPath, topicMetadata} from "@/lib/seo/topics";
import dynamic from "next/dynamic";

const Experience = dynamic(() => import("@/components/Experience"));

export async function generateMetadata({searchParams}: {searchParams: Promise<{point?: string}>}) {
 const {point} = await searchParams;
 if (!point) return {};
 const path = pointPath(point, await getUniverseCatalog());
 if (!path) return {};
 const [region, topic] = path.slice(1).split("/");
 return topicMetadata(region,topic);
}
export default function Home() {
  return <Experience />;
}
