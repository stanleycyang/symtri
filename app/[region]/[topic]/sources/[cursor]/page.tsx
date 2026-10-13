import TopicLanding from "@/components/TopicLanding";
import {topicMetadata} from "@/lib/seo/topics";

export const revalidate = 3600;
type Props = {params: Promise<{region: string; topic: string; cursor: string}>};
export async function generateMetadata({params}: Props) {
  const {region, topic, cursor} = await params;
  return topicMetadata(region, topic, cursor);
}
export default async function Page({params}: Props) {
  const {region, topic, cursor} = await params;
  return <TopicLanding region={region} topic={topic} cursor={cursor} />;
}
