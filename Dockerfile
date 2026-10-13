# ==============================================================================
# Axioma Zero-Trust MCP Gateway - Container Image
# Runs the standalone Zero-Trust JSON-RPC Gateway proxy
# ==============================================================================

FROM node:20-alpine AS base
WORKDIR /app

# Install system dependencies
RUN apk add --no-cache libc6-compat

# Copy package descriptors and install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy project source and configuration
COPY tsconfig.json drizzle.config.ts ./
COPY src ./src
COPY drizzle ./drizzle

# Set default production environment variables
ENV NODE_ENV=production
ENV PORT=3001
ENV GATEWAY_PORT=3001
ENV TARGET_MCP_URL=http://localhost:3000

# Expose default Gateway proxy port
EXPOSE 3001

# Health check against gateway health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT:-3001}/health || exit 1

# Start the Axioma MCP Gateway server
CMD ["npx", "tsx", "src/gateway/server.ts"]
