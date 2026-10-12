import Link from "next/link";
import {seedCatalog} from "@/lib/universe";
import {creator, serializeJsonLd} from "@/lib/seo/jsonld";
export const metadata = {title: "About SYMTRI — sources and methodology", description: "How SYMTRI maps technology, connects public sources, and grounds Ask answers in evidence.", alternates: {canonical: "/about"}};
const referral = "?utm_source=symtri&utm_medium=referral&utm_campaign=about";
export default function About() { return <main className="editorial-page"><nav><Link href="/">SYMTRI ↗</Link></nav><h1>A map of what technology is thinking about.</h1>
<section><h2>What it is</h2><p>SYMTRI is an open source map of research, software, and ideas. Explore regions, follow a thread, and read the original sources behind connections.</p></section>
<section><h2>How it works</h2><p>Hourly ingestion collects public observations. Classification places them into regions and threads. Shared sources and subject similarity connect regions. The live map follows a rolling fourteen-day window; saved snapshots let you revisit earlier observations.</p><p>Activity measures attention in the sources we cover. It is not a complete picture of the internet, a quality ranking, or a prediction. Quiet threads may reflect limited coverage.</p></section>
<section><h2>Sources and licenses</h2><p>Sources include {Object.values(seedCatalog.sourceLabels).join(", ")}. Availability varies by run. Each story links to its original publisher.</p><p>The SYMTRI software is <a href="https://github.com/stanleycyang/symtri/blob/main/LICENSE">MIT licensed</a>. Articles, abstracts, repositories, and other source materials retain their own licenses and attribution. The software license does not grant rights to republish third-party content.</p></section>
<section><h2>Ask SYMTRI</h2><p>Ask explores the archive and uses AI to synthesize available evidence. Answers include source links so you can check the claims. AI can misread evidence, and an empty result means we lack matching sources. It does not prove that a subject has no activity.</p></section>
<section><h2>Open source</h2><p><a href="https://github.com/stanleycyang/symtri">Explore the code, report an issue, or contribute on GitHub ↗</a></p></section>
<section><h2>About the creator</h2><p>Built by <a href={"https://stanleycyang.com" + referral}>Stanley Yang</a>. Explore <a href={"https://faroway.ai" + referral}>Faroway</a> and <a href={"https://doodlemania.app" + referral}>Doodlemania</a>.</p></section>
<Link className="editorial-cta" href="/">Enter the universe ↗</Link>
<script type="application/ld+json" dangerouslySetInnerHTML={{__html: serializeJsonLd({"@context": "https://schema.org", "@type": "AboutPage", name: "About SYMTRI", url: "https://symtri.com/about", about: creator})}} /></main>; }
