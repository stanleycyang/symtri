import SourceLink from "@/components/SourceLink";
import Link from "next/link";
import { resolvePage, pageEvidence, pointPath, pageFeed } from "@/lib/seo/topics";
import { breadcrumbSchema, datasetSchema, serializeJsonLd } from "@/lib/seo/jsonld";
export default async function TopicLanding({region: slug, topic}: {region: string; topic?: string}) {
  const page = await resolvePage(slug, topic);
  const {catalog, region, child, name, description, path, id} = page;
  const {events, unavailable} = await pageEvidence(region.id, child?.id ?? null);
  const feed = await pageFeed();
  const activity = feed?.activity?.[region.id];
  const dates = events.map(event => event.publishedAt).sort();
  const crumbs = [{name: "Home", path: "/"}, {name: region.name, path: `/${region.id}`}, ...(child ? [{name, path}] : [])];
  return <main className="editorial-page" style={{"--region-color": region.color} as React.CSSProperties}>
    <nav aria-label="Breadcrumb">{crumbs.map(item => <Link key={item.path} href={item.path}>{item.name}</Link>)}</nav>
    <p className="eyebrow">THE INTERNET IS THINKING</p><h1>{name}</h1><p className="editorial-lead">{description}</p>
    <p>SYMTRI organizes observations from public sources into a living map. Connections reflect shared subject matter; they do not establish causation or endorse a source.</p>
    <Link className="editorial-cta" href={`/?point=${id}`}>Open in the map ↗</Link>
    {activity && !child && <p><strong>{activity.count} observations in the fourteen-day window.</strong> Recent momentum: {activity.momentum}. These counts include observations awaiting readable evidence.</p>}
    {child && feed?.publishedEvidence && <p><strong>{feed.publishedEvidence.childCounts[child.id] ?? 0} readable sources in the fourteen-day window.</strong></p>}
    <section><h2>Recent sources</h2><p>Up to ten recent sources with readable evidence. This list is a sample, not a measure of total activity.</p>
      {events.length ? <ol className="editorial-sources">{events.map(event => <li key={event.id}><small>{catalog.sourceLabels[event.source] ?? event.source} · <time dateTime={event.publishedAt}>{event.publishedAt.slice(0,10)}</time></small><h3><SourceLink href={event.url} sourceId={event.source}>{event.title} ↗</SourceLink></h3><p>{event.summary}</p></li>)}</ol> : <p>{unavailable ? "Sources are temporarily unavailable. You can still explore the map." : "No readable sources are available for this subject yet. Coverage grows as new observations arrive."}</p>}
    </section><section><h2>{child ? "Related threads" : "Follow a thread"}</h2><div className="editorial-links">{region.children.filter(item => item.id !== child?.id).map(item => <Link key={item.id} href={pointPath(item.id, catalog)!}>{item.name} ↗</Link>)}</div></section>
    <section><h2>Connected regions</h2><div className="editorial-links">{catalog.topicEdges.filter(edge => edge.includes(region.id)).map(edge => { const other = catalog.topics.find(item => item.id === edge.find(id => id !== region.id)); return other ? <Link key={other.id} href={`/${other.id}`}>{other.name} ↗</Link> : null; })}</div></section>
    <footer><Link href="/about">About SYMTRI</Link> · <Link href="/">Explore the universe</Link></footer>
    <script type="application/ld+json" dangerouslySetInnerHTML={{__html: serializeJsonLd([datasetSchema(name, description, path, dates[0], dates.at(-1)), breadcrumbSchema(crumbs)])}} />
  </main>;
}
