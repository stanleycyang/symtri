import {seedCatalog} from "@/lib/universe";

/** The welcome screen does not need a running WebGL scene. */
export default function EntrancePreview() {
  const points = new Map(seedCatalog.topics.map(topic => [topic.id, {x: 500 + topic.position[0] * 10, y: 310 - topic.position[1] * 10, color: topic.color}]));
  return <svg className="entrance-constellation" viewBox="0 0 1000 620" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    {seedCatalog.topicEdges.map(([a, b]) => {
      const from = points.get(a)!;
      const to = points.get(b)!;
      return <line key={`${a}-${b}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={from.color} strokeOpacity=".14" />;
    })}
    {[...points].map(([id, point]) => <circle key={id} cx={point.x} cy={point.y} r="4" fill={point.color} fillOpacity=".6" />)}
  </svg>;
}
