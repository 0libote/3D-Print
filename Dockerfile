FROM --platform=$BUILDPLATFORM oven/bun:1.4.3-slim AS source
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --ignore-scripts
COPY . .
FROM source AS test
RUN bun test

FROM source AS build
RUN bun run build

FROM oven/bun:1.4.3-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATA_DIR=/app/data
COPY --from=build /app/package.json /app/bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts
COPY --from=build /app/server ./server
COPY --from=build /app/shared ./shared
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/data && chown bun:bun /app/data
USER bun
EXPOSE 3000
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=30s CMD bun -e 'fetch("http://localhost:"+(process.env.PORT||3000)+"/healthz").then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))'
STOPSIGNAL SIGTERM
CMD ["bun", "server/index.ts"]
