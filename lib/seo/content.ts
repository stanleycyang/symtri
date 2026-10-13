/** Editorial context describes the subject; live claims must come from the archive. */
const regions: Record<string, string> = {
  ai: "Artificial intelligence covers systems that learn from data, generate content, perceive their surroundings, or act toward a goal. Follow model research, agent tooling, evaluation, and the infrastructure used to build and run these systems.",
  software: "Software turns computational ideas into tools and services. This region follows open source projects, developer tools, programming languages, databases, operating systems, and web and cloud platforms.",
  science: "Science investigates the natural world through observation, experiments, and mathematical models. Explore papers and developments in biology, medicine, materials, neuroscience, physics, climate, and mathematics; a reported finding is not necessarily established consensus.",
  space: "Space research and engineering study the universe and build the systems used to reach and observe it. Follow astronomy, spacecraft, launch systems, satellites, exploration, and Earth observation.",
  energy: "Energy research and engineering concern how power is produced, stored, delivered, and consumed. Follow solar and nuclear power, fusion, geothermal systems, batteries, electricity grids, and changing power demand.",
  markets: "Markets connect capital, goods, services, and labor. This region follows economic developments, public markets, venture capital, fintech, and commerce. Source attention does not constitute financial advice or forecast investment returns.",
  security: "Digital security protects systems, software, accounts, and information from misuse. Explore cybersecurity, vulnerabilities, threat intelligence, cryptography, privacy, and identity, with links to the underlying advisories and research.",
  hardware: "Hardware is the physical foundation of computing: chips, sensors, devices, networks, and the processes that manufacture them. Follow semiconductor research, compute architectures, and engineering developments alongside their software and energy connections.",
  startups: "Startups explore new products and businesses under uncertainty. Follow founder experiences, product development, funding, growth, and design; public launches and funding announcements are observations rather than proof of commercial success.",
  crypto: "Crypto covers cryptographic networks, digital assets, and applications built on shared ledgers. Follow Bitcoin, Ethereum, protocols, stablecoins, and onchain applications. Technical activity does not establish an asset’s investment value or safety.",
};

const threads: Record<string, {name: string; definition: string}> = {
  "ai-agents": {name: "AI agents", definition: "AI agents use models to choose actions, call tools, and work toward a goal. This thread follows agent frameworks, memory, orchestration, evaluation, and safeguards; autonomy and reliability vary between systems."},
  "ai-coding-agents": {name: "AI coding agents", definition: "AI coding agents use models and development tools to inspect, modify, and test software. Follow coding workflows, repository tooling, evaluations, and evidence about where these systems succeed or fail."},
  "ai-language-models": {name: "Language models", definition: "Language models learn patterns in text and other representations to predict or generate sequences. Follow model releases, training methods, reasoning, evaluation, and deployment research; a benchmark result is specific to its test conditions."},
  "ai-ai-infrastructure": {name: "AI infrastructure", definition: "AI infrastructure comprises the compute, storage, serving systems, and operational tools used to train and deploy models. Follow inference engines, distributed training, observability, and the costs and constraints of running AI workloads."},
  "ai-computer-vision": {name: "Computer vision", definition: "Computer vision uses computational models to interpret images and video. Follow recognition, detection, segmentation, visual understanding, and evaluation across research and practical systems."},
  "ai-multimodal-systems": {name: "Multimodal AI systems", definition: "Multimodal AI systems process or generate more than one kind of information, such as text, images, audio, and video. Follow model architectures, cross-modal reasoning, interfaces, and evaluation."},
  "ai-robotics": {name: "AI and robotics", definition: "Robotics combines physical machines with sensing, planning, and control. This AI thread follows learning-based robot policies, simulation, perception, and evaluation in physical environments."},
  "ai-research": {name: "AI research", definition: "AI research investigates learning algorithms, model behavior, evaluation, and the limits of intelligent systems. Follow original papers and research artifacts; preprints may change and are not necessarily peer reviewed."},
  "software-developer-tools": {name: "Developer tools", definition: "Developer tools help people build, debug, test, and maintain software. Follow editors, command-line tools, build systems, testing frameworks, and workflow improvements with links to the original projects."},
  "software-open-source": {name: "Open source software", definition: "Open source software makes source code available under licenses that grant specified rights to use, modify, and share it. Follow public projects and releases; availability, maintenance, and license terms should be checked in each repository."},
  "software-databases": {name: "Databases", definition: "Databases organize information for storage and retrieval. Follow relational and nonrelational systems, query engines, indexing, replication, and operational tools; performance claims depend on workload and configuration."},
  "software-web-platforms": {name: "Web platforms", definition: "Web platforms provide the browser capabilities, frameworks, and server systems used to deliver websites and applications. Follow platform changes, rendering, deployment, and practical web engineering."},
  "security-cybersecurity": {name: "Cybersecurity", definition: "Cybersecurity protects digital systems against unauthorized access, disruption, and exploitation. Follow security research and advisories, distinguishing demonstrated vulnerabilities from speculation about threats."},
};

export function subjectContent(regionId: string, regionName: string, name: string, childId?: string) {
  const thread = childId ? threads[childId] : undefined;
  const subject = thread?.name ?? name;
  const definition = thread?.definition ?? (childId
    ? `This ${regionName.toLowerCase()} thread follows ${name.toLowerCase()} through original research, public projects, and source reports. Read the evidence below to see which developments are represented in SYMTRI’s archive.`
    : regions[regionId] ?? `Explore ${name.toLowerCase()} through research, projects, and public source reports in SYMTRI’s archive.`);
  return {subject, definition, description: `${subject} research, projects, and news with original source links. Explore recent evidence and related ${regionName.toLowerCase()} developments in SYMTRI.`};
}

export const MIN_INDEXABLE_SOURCES = 3;
/** A small editorial quality floor; sparse subjects remain public and browsable. */
export function evidenceIndexable(eventCount: number, unavailable: boolean): boolean | undefined {
  return unavailable ? undefined : eventCount >= MIN_INDEXABLE_SOURCES;
}
