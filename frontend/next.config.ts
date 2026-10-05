import type { NextConfig } from "next";

// Optional same-origin API proxy, used by the Vercel deployment.
//
// The backend lives on a different site (Tailscale Funnel), so a direct
// browser -> backend call needs a third-party cookie. Safari/iOS (every iOS
// browser), Brave and Chrome's stricter modes block those, which breaks
// login. When API_PROXY_TARGET is set, Vercel proxies /api/* to the backend
// server-side, so the browser only ever talks to the frontend's own origin
// and the session cookie is first-party everywhere.
//
// Pair it with NEXT_PUBLIC_API_URL=/api. Leave both unset for local dev: the
// frontend then calls http://localhost:8000 directly and no rewrite exists.
const apiProxyTarget = process.env.API_PROXY_TARGET?.replace(/\/+$/, "");

const nextConfig: NextConfig = {
  async rewrites() {
    if (!apiProxyTarget) return [];
    return [{ source: "/api/:path*", destination: `${apiProxyTarget}/:path*` }];
  },
};

export default nextConfig;
