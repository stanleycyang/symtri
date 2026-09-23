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
  events: Signal[];
};
export type Signal = {
  id: string;
  title: string;
  source: "Hacker News" | "GitHub" | "arXiv";
  age: string;
  summary: string;
};

type Seed = [string, string, string, Vec3, string, number, number, number, string[]];
const seeds: Seed[] = [
  ["ai", "Artificial Intelligence", "AI", [-11, 4, 2], "#d5a878", 96, 184, 4218, ["Agents", "Language Models", "Robotics", "Computer Vision", "AI Infrastructure", "Research", "Coding Agents", "Multimodal Systems"]],
  ["software", "Software", "SOFTWARE", [1, 9, -8], "#8baab0", 72, 42, 3291, ["Developer Tools", "Open Source", "Databases", "Web Platforms", "Cloud", "Programming Languages", "Operating Systems"]],
  ["science", "Science", "SCIENCE", [13, 5, -6], "#b7add9", 65, 63, 1684, ["Biotechnology", "Materials", "Neuroscience", "Physics", "Climate Science", "Mathematics", "Medicine"]],
  ["space", "Space", "SPACE", [19, -3, -1], "#b0aec3", 49, 31, 903, ["Launch Systems", "Satellites", "Exploration", "Astronomy", "Earth Observation", "Spacecraft"]],
  ["energy", "Energy", "ENERGY", [10, -10, 3], "#d8ad83", 82, 112, 1819, ["Nuclear", "Solar", "Grid", "Battery Storage", "Fusion", "Geothermal", "Power Demand"]],
  ["markets", "Markets", "MARKETS", [-3, -12, -5], "#b8bb9b", 58, 28, 2540, ["Venture Capital", "Public Markets", "Economy", "Fintech", "Labor", "Commerce"]],
  ["security", "Security", "SECURITY", [-17, -7, -3], "#b28f9e", 69, 78, 1287, ["Cybersecurity", "Privacy", "Identity", "Open Source Security", "Threat Intelligence", "Cryptography"]],
  ["hardware", "Hardware", "HARDWARE", [-1, 1, 10], "#9aa9c4", 76, 91, 1519, ["Semiconductors", "Chips", "Compute", "Devices", "Manufacturing", "Networks", "Sensors"]],
  ["startups", "Startups", "STARTUPS", [-10, -1, -11], "#c3a690", 61, 51, 2016, ["Founders", "Product", "Funding", "Growth", "Design", "New Ventures"]],
  ["crypto", "Crypto", "CRYPTO", [13, 1, 9], "#9baec1", 53, 37, 1102, ["Ethereum", "Bitcoin", "Protocols", "Stablecoins", "Digital Identity", "Onchain Apps"]],
];

function hash(input: string) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) h = Math.imul(h ^ input.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}
const sourceNames = ["Hacker News", "GitHub", "arXiv"] as const;
const templates = [
  (name: string) => `A new approach to ${name.toLowerCase()} is gaining attention`,
  (name: string) => `What changed in ${name.toLowerCase()} this week`,
  (name: string) => `Open research connects ${name.toLowerCase()} to the next wave of technology`,
];
export const topics: Topic[] = seeds.map(([id, name, short, position, color, activity, change, signals, names]) => ({
  id, name, short, description: `In this simulated map, ${name} draws ${signals.toLocaleString()} signals across research, code, and conversation.`, position, color, activity, change, signals,
  children: names.map((childName, index) => {
    const angle = index * Math.PI * 2 / names.length + hash(id) * 2;
    const radius = 4.1 + hash(id + childName) * 2.3;
    const childPosition: Vec3 = [position[0] + Math.cos(angle) * radius, position[1] + Math.sin(angle) * radius * .72, position[2] + (hash(childName) - .5) * 5];
    return {
      id: `${id}-${childName.toLowerCase().replaceAll(" ", "-")}`,
      name: childName, position: childPosition,
      activity: Math.round(activity * (.44 + hash(childName) * .5)),
      signals: Math.round(signals / names.length * (.65 + hash(childName + id) * .7)),
      events: [0, 1, 2].map((number) => ({
        id: `${id}-${index}-${number}`,
        title: templates[number](childName),
        source: sourceNames[(index + number) % 3],
        age: ["2 hours ago", "6 hours ago", "yesterday"][number],
        summary: `A simulated signal about ${childName.toLowerCase()}, shown to demonstrate how live stories will appear in this region.`,
      })),
    };
  }),
}));

export const topicEdges: [string, string][] = [
  ["ai", "software"], ["ai", "hardware"], ["ai", "energy"], ["ai", "science"], ["software", "security"],
  ["software", "startups"], ["science", "space"], ["science", "energy"], ["energy", "markets"],
  ["markets", "startups"], ["markets", "crypto"], ["hardware", "space"], ["hardware", "crypto"],
];

export function getTopic(id: string | null) { return topics.find((topic) => topic.id === id) ?? null; }
