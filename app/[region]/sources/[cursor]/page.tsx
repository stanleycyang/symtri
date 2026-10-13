import TopicLanding from "@/components/TopicLanding";
import {topicMetadata} from "@/lib/seo/topics";

export const revalidate = 3600;
type Props = {params: Promise<{region: string; cursor: string}>};
export async function generateMetadata({params}: Props) {
  const {region, cursor} = await params;
  return topicMetadata(region, undefined, cursor);
}
export default async function Page({params}: Props) {
  const {region, cursor} = await params;
  return <TopicLanding region={region} cursor={cursor} />;
}
