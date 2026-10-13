/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  basePath: '/axioma',
  output: 'standalone',
  experimental: {
    outputFileTracingIncludes: {
      '/api/**/*': ['./src/graphql/**/*', './src/machines/**/*'],
    },
  },
  async redirects() {
    return [
      {
        source: '/',
        destination: '/axioma',
        basePath: false,
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
