import SourceLink from "@/components/SourceLink";
import ShareButton from "@/components/ShareButton";
import Link from "next/link";
import { resolvePage, pageEvidence, pointPath, pageFeed } from "@/lib/seo/topics";
import { breadcrumbSchema, datasetSchema, serializeJsonLd } from "@/lib/seo/jsonld";
import {relationshipKey} from "@/lib/data/activity";
import {sourceDatePresentation} from "@/lib/data/source-presentation";
export default async function TopicLanding({region: slug, topic, cursor = null}: {region: string; topic?: string; cursor?: string | null}) {
  const page = await resolvePage(slug, topic);
  const {catalog, region, child, name, subject, definition, description, path, id} = page;
  const {events, nextCursor, unavailable} = await pageEvidence(region.id, child?.id ?? null, cursor);
  const feed = await pageFeed();
  const activity = feed?.activity?.[region.id];
  const end=feed?.observedAt;
  const start=end ? new Date(Date.parse(end)-14*86400000).toISOString() : undefined;
  const count=child ? feed?.childCounts?.[child.id] : activity?.count;
  const crumbs = [{name: "Home", path: "/"}, {name: region.name, path: `/${region.id}`}, ...(child ? [{name, path}] : [])];
  const connections = catalog.topics.filter(other => other.id !== region.id).map(other => ({other, count: feed?.relationships?.[relationshipKey(region.id, other.id)] ?? 0})).filter(link => link.count > 0).sort((a, b) => b.count - a.count);
  const pagePath = cursor ? `${path}/sources/${encodeURIComponent(cursor)}` : path;
  const schemas = [
    {"@context": "https://schema.org", "@type": "CollectionPage", name: subject, description, url: `https://symtri.com${pagePath}`, ...(events.length ? {mainEntity: {"@type": "ItemList", itemListElement: events.map((event, index) => {
      const date = sourceDatePresentation(event.source);
      return {"@type": "ListItem", position: index + 1, item: {"@type": "CreativeWork", name: event.title, url: event.url, ...(date.schemaProperty ? {[date.schemaProperty]: event.publishedAt} : {})}};
    })}} : {})},
    ...(count !== undefined && !cursor ? [datasetSchema(subject, description, path, start, end, count, child ? undefined : activity?.momentum)] : []),
    breadcrumbSchema(crumbs),
  ];
  return <main className="editorial-page" style={{"--region-color": region.color} as React.CSSProperties}>
    <nav aria-label="Breadcrumb">{crumbs.map(item => <Link key={item.path} href={item.path}>{item.name}</Link>)}</nav>
    <p className="eyebrow">THE INTERNET IS THINKING</p><h1>{cursor ? `Earlier sources: ${subject}` : subject}</h1><p className="editorial-lead">{definition}</p>
    <p>SYMTRI organizes observations from public sources into a living map. Connections reflect shared subject matter; they do not establish causation or endorse a source.</p>
    <Link className="editorial-cta" href={`/?point=${id}`}>Open in the map ↗</Link>
    <ShareButton path={path} title={name} point={id} />
    {activity && !child && <p><strong>{activity.count} classified signals in the fourteen-day window.</strong> Recent momentum: {activity.momentum}. These counts include signals awaiting readable evidence.</p>}
    {child && feed?.childCounts && <p><strong>{feed.childCounts[child.id] ?? 0} classified signals in the fourteen-day window.</strong> These counts include signals awaiting readable evidence.</p>}
    <section><h2>{cursor ? "Earlier sources" : "Recent sources"}</h2><p>Up to ten sources with readable evidence, ordered by their feed timestamp. These archive sources can be older than the live fourteen-day window. This list is a sample, not a measure of total activity. Dates distinguish paper publication, repository creation, model/dataset activity, Hacker News posts, and KEV catalog additions. “First archived” records when SYMTRI first stored the signal.</p>
      {events.length ? <ol className="editorial-sources">{events.map(event => <li key={event.id}><small>{catalog.sourceLabels[event.source] ?? event.source} · {sourceDatePresentation(event.source).label} <time dateTime={event.publishedAt}>{event.publishedAt.slice(0,10)}</time>{event.firstSeenAt && <> · First archived <time dateTime={event.firstSeenAt}>{event.firstSeenAt.slice(0,10)}</time></>}</small><h3><SourceLink href={event.url} sourceId={event.source}>{event.title} ↗</SourceLink></h3><p>{event.summary}</p></li>)}</ol> : <p>{unavailable ? "Sources are temporarily unavailable. You can still explore the map." : "No readable sources are available for this subject yet. Coverage grows as new observations arrive."}</p>}
      {(nextCursor || cursor) && <nav className="source-pagination" aria-label="Source pages">{cursor && <Link href={path}>Newest sources</Link>}{nextCursor && <Link prefetch={false} href={`${path}/sources/${encodeURIComponent(nextCursor)}`}>Earlier sources ↗</Link>}</nav>}
    </section>
    {end && <p>Live window recorded <time dateTime={end}>{new Date(end).toLocaleString("en-US", {timeZone: "UTC", dateStyle: "medium", timeStyle: "short"})} UTC</time>. This is the ingestion observation time, not the publication or discovery date of each source.</p>}
    <section><h2>How to assess evidence about {subject}</h2><p>Check each original source for its methods, release status, limitations, and supporting data. A repository announcement, a preprint, and a published study provide different kinds of evidence. SYMTRI’s subject classification helps discovery; it does not independently validate the source’s claims.</p><p><Link href="/about#methodology">See the collection and counting methodology ↗</Link> · <Link href="/signal">Read the weekly synthesis ↗</Link></p></section>
    <section><h2>{child ? "Related threads" : "Follow a thread"}</h2><div className="editorial-links">{region.children.filter(item => item.id !== child?.id).map(item => <Link prefetch={false} key={item.id} href={pointPath(item.id, catalog)!}>{item.name} ↗</Link>)}</div></section>
    {connections.length > 0 && <section><h2>Observed region connections</h2><p>Full fourteen-day archive counts of classified signals shared by {region.name.toLowerCase()} and another region, including signals awaiting readable evidence. These region totals are not specific to this thread. One signal may connect several regions.</p><ul>{connections.map(({other, count}) => <li key={other.id}><Link href={`/?point=${region.id}&connection=${other.id}`}>{region.name} × {other.name}</Link>: {count} shared signals</li>)}</ul></section>}
    <section><h2>Explore related regions</h2><p>These navigation suggestions are part of the map’s editorial structure, rather than measured evidence of a connection.</p><div className="editorial-links">{catalog.topicEdges.filter(edge => edge.includes(region.id)).map(edge => { const other = catalog.topics.find(item => item.id === edge.find(id => id !== region.id)); return other ? <Link key={other.id} href={`/${other.id}`}>{other.name} ↗</Link> : null; })}</div></section>
    <footer><Link href="/about">About SYMTRI</Link> · <Link href="/signal">Weekly report</Link> · <Link href="/">Explore the universe</Link></footer>
    <script type="application/ld+json" dangerouslySetInnerHTML={{__html: serializeJsonLd(schemas)}} />
  </main>;
}
