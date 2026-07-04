// Allow next/image to optimize gallery images served by the backend. Derived from
// the same base the API client uses so it matches whatever origin serves images.
const apiBase = new URL(process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: apiBase.protocol.replace(":", ""),
        hostname: apiBase.hostname,
        port: apiBase.port,
        pathname: "/api/images/**",
      },
    ],
  },
  modularizeImports: {
    "@mui/icons-material": {
      transform: "@mui/icons-material/{{member}}",
    },
  },
};

export default nextConfig;
