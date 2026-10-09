FROM alpine:3.24.2 AS node-base

# The hosted image is linux/amd64. Use the upstream musl build until the official
# Node Alpine image includes this runtime; do not silently run a foreign binary.
ARG TARGETARCH
RUN test "$TARGETARCH" = amd64
ADD --checksum=sha256:8d31c2180212503799c3c93924db216e236de769b4ca1fdfe85a33ebacae510c \
    https://nodejs.org/dist/v26.11.1/node-v26.11.1-linux-x64-musl.tar.xz /tmp/node.tar.xz
RUN apk upgrade --no-cache \
    && apk add --no-cache libstdc++ libatomic ca-certificates \
    && apk add --no-cache --virtual .extract-deps xz \
    && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
    && rm /tmp/node.tar.xz \
    && apk del .extract-deps \
    && addgroup -g 1000 node \
    && adduser -u 1000 -G node -s /bin/sh -D node \
    && node -e 'if (process.versions.openssl !== "3.5.9" || process.versions.undici !== "8.11.2") process.exit(1)'

FROM node-base AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node-base AS runtime
RUN apk upgrade --no-cache

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
COPY --chmod=755 scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

USER node
ENTRYPOINT ["docker-entrypoint.sh"]
EXPOSE 8080
CMD ["node", "dist/remote.js"]
