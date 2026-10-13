import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const config: NextConfig = {
  // One Postgres connection per worker; concurrent prerenders otherwise queue
  // their archive reads behind each other and hit Next's page deadline.
  experimental: { staticGenerationMaxConcurrency: 1 },
  async redirects() {
    return [{
      // Public pages use one host. Keep API and Workflow callers on their
      // original host so a cross-origin redirect cannot strip authorization.
      source: "/:path((?!(?:api|\\.well-known)(?:/|$)).*)",
      has: [{type: "host", value: "www.symtri.com"}],
      destination: "https://symtri.com/:path",
      permanent: true,
    }];
  },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        { key: "Content-Security-Policy", value: "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self' https://buttondown.com" },
      ],
    }];
  },
};

export default withWorkflow(config);
