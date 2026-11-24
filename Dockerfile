FROM node:24-bookworm-slim AS toolchain
ENV HUSKY=0 CI=true
RUN npm install --global pnpm@12.21.0

FROM toolchain AS sdk
WORKDIR /build/NestCloud-Sdk
COPY NestCloud-Sdk/ ./
RUN pnpm install --frozen-lockfile && pnpm run build

FROM toolchain AS dependencies
COPY --from=sdk /build/NestCloud-Sdk/package.json /build/NestCloud-Sdk/
COPY --from=sdk /build/NestCloud-Sdk/.husky /build/NestCloud-Sdk/.husky
COPY --from=sdk /build/NestCloud-Sdk/dist /build/NestCloud-Sdk/dist

FROM dependencies AS registry-build
WORKDIR /build/NestCloud
COPY NestCloud/ ./
RUN pnpm install --frozen-lockfile && pnpm run build && pnpm prune --prod

FROM node:24-bookworm-slim AS registry-image
ENV NODE_ENV=production NodeEnv=production
WORKDIR /app
COPY --from=registry-build /build/NestCloud/node_modules ./node_modules
COPY --from=registry-build /build/NestCloud/dist ./dist
COPY --from=registry-build /build/NestCloud/public ./public
COPY --from=registry-build /build/NestCloud/package.json ./
RUN chown node:node /app
USER node
EXPOSE 3001
CMD ["node", "dist/main.js"]
