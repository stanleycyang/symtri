export type Vec3 = [number, number, number];
export type Topic = {
  id: string;
  name: string;
  short: string;
  description: string;
  position: Vec3;
  color: string;
  activity: number;
  change: number;
  signals: number;
  children: Subtopic[];
};
export type Subtopic = {
  id: string;
  name: string;
  position: Vec3;
  activity: number;
  signals: number;
};
export type UniverseCatalog = { revision: number; topics: Topic[]; topicEdges: [string, string][]; sourceLabels: Record<string, string>; redirects?: Record<string, string> };

type Seed = [string, string, string, Vec3, string, string[]];
const seeds: Seed[] = [
  ["ai", "Artificial Intelligence", "AI", [-11, 4, 2], "#d5a878", ["Agents", "Language Models", "Robotics", "Computer Vision", "AI Infrastructure", "Research", "Coding Agents", "Multimodal Systems"]],
  ["software", "Software", "SOFTWARE", [1, 9, -8], "#8baab0", ["Developer Tools", "Open Source", "Databases", "Web Platforms", "Cloud", "Programming Languages", "Operating Systems"]],
  ["science", "Science", "SCIENCE", [13, 5, -6], "#b7add9", ["Biotechnology", "Materials", "Neuroscience", "Physics", "Climate Science", "Mathematics", "Medicine"]],
  ["space", "Space", "SPACE", [19, -3, -1], "#b0aec3", ["Launch Systems", "Satellites", "Exploration", "Astronomy", "Earth Observation", "Spacecraft"]],
  ["energy", "Energy", "ENERGY", [10, -10, 3], "#d8ad83", ["Nuclear", "Solar", "Grid", "Battery Storage", "Fusion", "Geothermal", "Power Demand"]],
  ["markets", "Markets", "MARKETS", [-3, -12, -5], "#b8bb9b", ["Venture Capital", "Public Markets", "Economy", "Fintech", "Labor", "Commerce"]],
  ["security", "Security", "SECURITY", [-17, -7, -3], "#b28f9e", ["Cybersecurity", "Privacy", "Identity", "Open Source Security", "Threat Intelligence", "Cryptography"]],
  ["hardware", "Hardware", "HARDWARE", [-1, 1, 10], "#9aa9c4", ["Semiconductors", "Chips", "Compute", "Devices", "Manufacturing", "Networks", "Sensors"]],
  ["startups", "Startups", "STARTUPS", [-10, -1, -11], "#c3a690", ["Founders", "Product", "Funding", "Growth", "Design", "New Ventures"]],
  ["crypto", "Crypto", "CRYPTO", [13, 1, 9], "#9baec1", ["Ethereum", "Bitcoin", "Protocols", "Stablecoins", "Digital Identity", "Onchain Apps"]],
];

function hash(input: string) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) h = Math.imul(h ^ input.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}
export const topics: Topic[] = seeds.map(([id, name, short, position, color, names]) => ({
  id, name, short, description: `Explore recent observations about ${name.toLowerCase()}.`, position, color, activity: 30, change: 0, signals: 0,
  children: names.map((childName, index) => {
    const angle = index * Math.PI * 2 / names.length + hash(id) * 2;
    const radius = 4.1 + hash(id + childName) * 2.3;
    const childPosition: Vec3 = [position[0] + Math.cos(angle) * radius, position[1] + Math.sin(angle) * radius * .72, position[2] + (hash(childName) - .5) * 5];
    return {
      id: `${id}-${childName.toLowerCase().replaceAll(" ", "-")}`,
      name: childName, position: childPosition,
      activity: 30,
      signals: 0,
    };
  }),
}));

export const topicEdges: [string, string][] = [
  ["ai", "software"], ["ai", "hardware"], ["ai", "energy"], ["ai", "science"], ["software", "security"],
  ["software", "startups"], ["science", "space"], ["science", "energy"], ["energy", "markets"],
  ["markets", "startups"], ["markets", "crypto"], ["hardware", "space"], ["hardware", "crypto"],
];

export const seedCatalog: UniverseCatalog = {
  revision: 0, topics, topicEdges,
  sourceLabels: { "hacker-news": "Hacker News", github: "GitHub", arxiv: "arXiv", openalex: "OpenAlex" },
};

export function getTopic(id: string | null, catalog: UniverseCatalog = seedCatalog) { return catalog.topics.find((topic) => topic.id === (id ? catalog.redirects?.[id] ?? id : null)) ?? null; }
