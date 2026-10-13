"use client";
import {Analytics} from "@vercel/analytics/next";
import {SpeedInsights} from "@vercel/speed-insights/next";
import {analyticsUrl} from "@/lib/analytics-url";
export default function SiteAnalytics() {
  return <><Analytics beforeSend={event=>({...event,url:analyticsUrl(event.url)})}/><SpeedInsights/></>;
}
