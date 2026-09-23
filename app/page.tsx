import dynamic from "next/dynamic";

const Experience = dynamic(() => import("@/components/Experience"));

export default function Home() {
  return <Experience />;
}
