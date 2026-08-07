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
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

USER node
EXPOSE 8080
CMD ["node", "dist/remote.js"]
