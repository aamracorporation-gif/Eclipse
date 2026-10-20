FROM node:24.14.0-bookworm-slim AS web
WORKDIR /build
COPY package.json package-lock.json ./
COPY scripts/patch-build-tools.cjs ./scripts/patch-build-tools.cjs
RUN npm ci --ignore-scripts --no-audit --no-fund && node scripts/patch-build-tools.cjs
COPY app ./app
COPY assets ./assets
COPY components ./components
COPY constants ./constants
COPY lib ./lib
COPY theme ./theme
COPY src ./src
COPY app.json app.config.js tsconfig.json babel.config.js metro.config.js ./
RUN npx expo export --platform web --output-dir dist

FROM node:24.14.0-bookworm-slim AS runtime
WORKDIR /app
COPY deploy/runtime/package.json deploy/runtime/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY --from=web /build/dist ./dist
COPY server ./server
COPY src/domain ./src/domain
COPY lib/normalize.ts ./lib/normalize.ts
COPY certs ./certs
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 RELEASE_MODE=beta
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","--experimental-strip-types","server/index.ts"]
