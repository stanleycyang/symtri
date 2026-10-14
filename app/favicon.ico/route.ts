export const runtime = "nodejs";
export const dynamic = "force-static";

// Minimal transparent PNG so /favicon.ico does not 404. Browsers accept PNG here.
const base64Png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=";

export function GET() {
  const body = Buffer.from(base64Png, "base64");
  return new Response(body, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
    },
  });
}

