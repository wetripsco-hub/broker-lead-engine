import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";
const isPreview = process.env.VERCEL_ENV === "preview";

// Supabase (REST + realtime). The project URL is known at build time.
const supabase = (() => {
  try {
    const host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").host;
    return host ? [`https://${host}`, `wss://${host}`] : ["https://*.supabase.co", "wss://*.supabase.co"];
  } catch {
    return ["https://*.supabase.co", "wss://*.supabase.co"];
  }
})();

const turnstile = "https://challenges.cloudflare.com";
const vercelLive = isPreview ? ["https://vercel.live", "wss://ws-us3.pusher.com"] : [];

// No nonces (pages stay statically optimisable), so inline scripts are allowed;
// everything else is limited to the services the browser really talks to.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} ${turnstile} ${vercelLive.join(" ")}`,
  "style-src 'self' 'unsafe-inline'",
  // Call recordings and avatars can come from provider storage (https).
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "font-src 'self' data:",
  [
    "connect-src 'self'",
    ...supabase,
    // Telnyx WebRTC (browser calling).
    "wss://rtc.telnyx.com",
    "https://*.telnyx.com",
    "wss://*.telnyx.com",
    // Deepgram live transcription (copilot).
    "wss://api.deepgram.com",
    "https://api.deepgram.com",
    turnstile,
    ...vercelLive,
    ...(isDev ? ["ws://localhost:*", "http://localhost:*"] : []),
  ].join(" "),
  // Recruiter tab: candidate videos play in the YouTube / Loom / Vimeo players.
  `frame-src 'self' blob: ${turnstile} https://www.youtube.com https://www.youtube-nocookie.com https://www.loom.com https://player.vimeo.com ${vercelLive.join(" ")}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
]
  .map((d) => d.replace(/\s+/g, " ").trim())
  .join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Microphone for browser calls on our own pages only; everything else off.
  {
    key: "Permissions-Policy",
    value: "microphone=(self), camera=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=(), browsing-topics=()",
  },
  // Two years. No includeSubDomains/preload: those would also bind every other
  // subdomain of the company domains to HTTPS, which is a separate decision.
  { key: "Strict-Transport-Security", value: "max-age=63072000" },
];

const nextConfig: NextConfig = {
  // unzipper conditionally requires @aws-sdk/client-s3 for its S3 source
  // (unused here — we only unzip local buffers). Keep it external so the
  // bundler doesn't try to statically resolve that optional dependency.
  serverExternalPackages: ["unzipper"],
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
