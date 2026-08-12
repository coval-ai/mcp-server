FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime

ARG COVAL_MCP_SOURCE_SHA=unknown
ARG COVAL_MCP_ENV=local
ENV NODE_ENV=production \
    COVAL_MCP_SOURCE_SHA=${COVAL_MCP_SOURCE_SHA} \
    DD_ENV=${COVAL_MCP_ENV} \
    DD_SERVICE=coval-mcp-server \
    DD_VERSION=${COVAL_MCP_SOURCE_SHA}
LABEL org.opencontainers.image.revision=${COVAL_MCP_SOURCE_SHA}
WORKDIR /app
COPY package.json package-lock.json ./
# The bundled package managers are build-time only -- the container runs `node dist/remote.js`.
# Dropping them in the same layer keeps their vendored dependencies out of the ECR scan surface.
RUN npm ci --omit=dev && npm cache clean --force \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
       /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
       /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-v*
COPY --from=build /app/dist ./dist

USER node
EXPOSE 8080
CMD ["node", "dist/remote.js"]
