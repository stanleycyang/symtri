import {seedCatalog} from "@/lib/universe";
import TopicLanding from "@/components/TopicLanding";
import {topicMetadata} from "@/lib/seo/topics";
export const revalidate = 3600;
export function generateStaticParams() { return seedCatalog.topics.flatMap(region => region.children.map(child => ({region: region.id, topic: child.id.slice(region.id.length + 1)}))); }
type Props = {params: Promise<{region: string; topic: string}>};
export async function generateMetadata({params}: Props) { const {region, topic} = await params; return topicMetadata(region, topic); }
export default async function Page({params}: Props) { const {region, topic} = await params; return <TopicLanding region={region} topic={topic} />; }
