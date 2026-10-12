import {seedCatalog} from "@/lib/universe";
import TopicLanding from "@/components/TopicLanding";
import {topicMetadata} from "@/lib/seo/topics";
export const revalidate = 3600;
export function generateStaticParams() { return seedCatalog.topics.map(region => ({region: region.id})); }
type Props = {params: Promise<{region: string}>};
export async function generateMetadata({params}: Props) { return topicMetadata((await params).region); }
export default async function Page({params}: Props) { return <TopicLanding region={(await params).region} />; }
