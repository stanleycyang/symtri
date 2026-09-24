import { topics } from "../universe";
import type { TopicMatch } from "./model";

// Bump this when the rules below change so stored signals are reclassified.
export const CLASSIFIER_VERSION = 2;

const topicTerms: Record<string, string[]> = {
  ai: ["ai", "artificial intelligence", "machine learning", "neural network", "llm", "gpt", "language model", "language models", "ai agent", "agentic", "transformer", "generative ai", "openai", "anthropic", "claude", "gemini 3", "qwen", "vlm"],
  software: ["developer", "programming", "database", "open source", "web framework", "compiler", "typescript", "javascript", "python", "rust", "linux", "cloud", "react", "postgres", "browser", "browsers", "sdk", "vscode", "vs code", "kafka", "nixos", "http", "debugger", "terminal", "tailscale"],
  science: ["biology", "biotech", "genome", "protein", "physics", "neuroscience", "mathematics", "medicine", "clinical", "crispr", "enzyme", "vaccine", "mrna", "dna", "quantum computing", "quantum computer", "quantum computers", "quantum software", "quantum algorithm", "quantum circuit", "quantum machine learning", "qubit", "qubits", "entanglement"],
  space: ["space", "satellite", "satellites", "rocket", "astronomy", "cosmology", "orbital", "spacecraft", "nasa"],
  energy: ["energy", "nuclear", "solar power", "solar panel", "solar panels", "solar cell", "solar cells", "photovoltaic", "power grid", "battery", "fusion", "geothermal", "electricity"],
  markets: ["market", "economy", "finance", "fintech", "venture capital", "trade", "investment", "commerce"],
  security: ["security", "cyber", "vulnerability", "malware", "privacy", "vpn", "encryption", "cryptography", "identity", "hacked", "hacking", "supply-chain attack"],
  hardware: ["hardware", "chip", "semiconductor", "gpu", "cpu", "compute", "device", "sensor", "manufacturing", "uefi", "vga", "vr glasses"],
  startups: ["startup", "founder", "funding", "seed round", "product launch", "launch hn", "venture", "growth"],
  crypto: ["crypto", "bitcoin", "ethereum", "blockchain", "stablecoin", "web3", "onchain"],
};

const childTerms: Record<string, string[]> = {
  "ai-agents": ["agent", "agents", "agentic", "tool use", "computer use"],
  "ai-language-models": ["llm", "llms", "language model", "language models", "transformer", "transformers", "foundation model", "foundation models"],
  "ai-robotics": ["robot", "robotics", "embodied"],
  "ai-computer-vision": ["computer vision", "image recognition", "video understanding"],
  "ai-ai-infrastructure": ["inference", "training infrastructure", "model serving"],
  "ai-coding-agents": ["coding agent", "coding agents", "code agent", "code agents", "programming agent", "programming agents"],
  "ai-multimodal-systems": ["multimodal", "vision language", "audio model"],
  "software-developer-tools": ["developer tool", "ide", "editor", "cli", "sdk"],
  "software-open-source": ["open source", "open-source"],
  "software-databases": ["database", "sql", "postgres", "vector database"],
  "software-web-platforms": ["browser", "web platform", "react", "next.js"],
  "software-cloud": ["cloud", "serverless", "kubernetes", "container"],
  "science-biotechnology": ["biotech", "protein", "genome", "crispr"],
  "science-neuroscience": ["brain", "neuroscience", "neuron"],
  "science-physics": ["physics", "quantum", "qubit", "entanglement"],
  "science-climate-science": ["climate", "carbon", "warming"],
  "space-launch-systems": ["rocket", "launch vehicle"],
  "space-satellites": ["satellite"],
  "space-astronomy": ["astronomy", "telescope", "galaxy"],
  "energy-nuclear": ["nuclear", "reactor", "smr"],
  "energy-solar": ["solar energy", "solar power", "solar panel", "solar panels", "solar cell", "solar cells", "photovoltaic"],
  "energy-battery-storage": ["battery", "storage"],
  "energy-power-demand": ["power demand", "data center power"],
  "markets-venture-capital": ["venture capital", "vc funding"],
  "markets-fintech": ["fintech", "payments"],
  "security-cybersecurity": ["cybersecurity", "cyberattack", "breach"],
  "security-cryptography": ["cryptography", "encryption", "zero knowledge"],
  "hardware-semiconductors": ["semiconductor", "foundry"],
  "hardware-chips": ["chip", "gpu", "cpu"],
  "hardware-compute": ["compute", "accelerator"],
  "startups-funding": ["funding", "seed round", "series a"],
  "startups-founders": ["founder", "founding"],
  "crypto-bitcoin": ["bitcoin", "btc"],
  "crypto-ethereum": ["ethereum", "eth"],
  "crypto-stablecoins": ["stablecoin"],
};

const categoryTerms: Record<string, string[]> = {
  ai: ["cs.AI", "cs.LG", "cs.CL", "cs.CV", "cs.RO"],
  software: ["cs.SE", "cs.NI"],
  markets: ["q-fin."],
  security: ["cs.CR"],
  space: ["astro-ph"],
  science: ["physics", "q-bio", "quant-ph"],
};

const boundary = (term: string) => new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replaceAll(" ", "[ -]")}($|[^a-z0-9])`, "i");
const patterns = new Map<string, RegExp>();
function hasTerm(text: string, term: string) {
  let pattern = patterns.get(term);
  if (!pattern) { pattern = boundary(term); patterns.set(term, pattern); }
  return pattern.test(text);
}
function matched(text: string, terms: string[]) { return terms.some((term) => hasTerm(text, term)); }
function strongestTerm(text: string, terms: string[]) { return terms.filter((term) => hasTerm(text, term)).reduce((length, term) => Math.max(length, term.length), 0); }

export function classifySignal(title: string, summary: string, categories: string[] = []): TopicMatch[] {
  const scored = topics.map((topic) => {
    const terms = topicTerms[topic.id] ?? [];
    const physicalEnergy = topic.id === "energy" && (
      /\b(?:dark|vacuum|holographic) energy\b/i.test(`${title} ${summary}`)
      || categories.some((category) => category.startsWith("astro-ph") || category === "gr-qc" || category === "hep-th")
    );
    if (physicalEnergy && !matched(`${title} ${summary}`, terms.filter((term) => term !== "energy"))) {
      return { topicId: topic.id, subtopicId: null, score: 0 };
    }
    const parentInTitle = matched(title, terms);
    const parentInSummary = matched(summary, terms);
    const parentInCategory = categories.some((category) => (categoryTerms[topic.id] ?? []).some((prefix) => category.startsWith(prefix)));
    let score = (parentInTitle ? 5 : 0) + (parentInSummary ? 1 : 0) + (parentInCategory ? 6 : 0);
    let bestChild: { id: string; score: number } | null = null;
    for (const child of topic.children) {
      const childAliases = childTerms[child.id] ?? [child.name.toLowerCase()];
      const childTitle = child.id === "ai-agents" ? title.replace(/\bforeign agents?\b/gi, "") : title;
      const titleMatch = strongestTerm(childTitle, childAliases);
      const childScore = titleMatch ? 5 + Math.min(3, titleMatch / 5) : 0;
      if (childScore > (bestChild?.score ?? 0)) bestChild = { id: child.id, score: childScore };
    }
    score = parentInTitle || parentInSummary || parentInCategory ? score + (bestChild?.score ?? 0) : 0;
    return { topicId: topic.id, subtopicId: bestChild?.id ?? null, score };
  }).filter((item) => item.score >= 4).sort((a, b) => b.score - a.score).slice(0, 2);
  return scored.map((item) => ({ topicId: item.topicId, subtopicId: item.subtopicId, relevance: Math.min(1, Number((item.score / 12).toFixed(2))) }));
}
