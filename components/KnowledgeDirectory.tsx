import Link from "next/link";
import {getUniverseCatalog} from "@/lib/data/catalog";
import {pointPath} from "@/lib/seo/paths";
import {seedCatalog} from "@/lib/universe";

export default async function KnowledgeDirectory() {
  const {catalog, unavailable} = await getUniverseCatalog().then(
    catalog => ({catalog, unavailable: false}),
    () => ({catalog: seedCatalog, unavailable: true}),
  );
  return <section id="browse-knowledge" tabIndex={-1} className="editorial-page knowledge-directory" aria-labelledby="browse-heading">
    <p className="eyebrow">FOLLOW THE EVIDENCE</p>
    <h2 id="browse-heading">Explore technology, research, and connected ideas</h2>
    <p className="editorial-lead">SYMTRI is a public knowledge map of research, software projects, and technology developments. Browse original sources by subject, explore connections, and ask questions grounded in the archive.</p>
    {unavailable && <p role="status">The live subject directory is temporarily unavailable. You can still browse the core subjects below.</p>}
    <nav aria-label="Knowledge resources" className="editorial-links"><Link href="/ai/agents">Follow AI agents</Link><Link href="/ai/coding-agents">Explore coding agents</Link><Link href="/signal">Read the weekly report</Link><Link href="/about">Sources and methodology</Link></nav>
    <div className="knowledge-grid">{catalog.topics.map(region => <section key={region.id}>
      <h3><Link prefetch={false} href={pointPath(region.id, catalog)!}>{region.name} ↗</Link></h3>
      <ul>{region.children.map(child => <li key={child.id}><Link prefetch={false} href={pointPath(child.id, catalog)!}>{child.name}</Link></li>)}</ul>
    </section>)}</div>
    <section><h2>What does this map measure?</h2><p>The live map describes attention in the public sources SYMTRI covers over a rolling fourteen-day window. Source coverage varies. Connections indicate shared subjects, not causation, consensus, or endorsement. Topic pages expose readable archive evidence independently of the map’s capped preview.</p><p><Link href="/about">Read how collection, classification, and AI answers work ↗</Link> · <a href="#universe">Return to the map ↑</a></p></section>
  </section>;
}
