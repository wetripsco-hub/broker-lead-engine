import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // unzipper conditionally requires @aws-sdk/client-s3 for its S3 source
  // (unused here — we only unzip local buffers). Keep it external so the
  // bundler doesn't try to statically resolve that optional dependency.
  serverExternalPackages: ["unzipper"],
};

export default nextConfig;
