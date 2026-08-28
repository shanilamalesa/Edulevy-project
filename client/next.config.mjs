/** @type {import('next').NextConfig} */
const nextConfig = {
  // Forward /api/* to the Express server. The browser sees one origin,
  // so the session cookie is sent without any CORS configuration.
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:4000/api/:path*',
      },
    ];
  },
};

export default nextConfig;