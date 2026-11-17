# Build stage: install deps and build the Vite bundle.
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Runtime stage: Node serves the SPA and the JSON API from one process.
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

# Runtime uses only Node built-ins (node:http, node:sqlite, node:crypto), so no
# node_modules are needed. Keep the image small and the supply chain empty.
# package.json is copied only so Node treats *.js as ES modules ("type": module).

COPY package.json ./
COPY --from=build /app/dist ./dist
COPY server ./server
# Private content (internal documents and seed CSVs) is never baked into the image: the GitHub
# repo is public. Production reads it from the persistent volume (see fly.toml RESOURCES_DIR/SEED_DIR).
RUN mkdir -p src
COPY --from=build /app/src/data.js ./src/data.js
COPY --from=build /app/src/money.js ./src/money.js
COPY --from=build /app/src/opportunityFields.js ./src/opportunityFields.js
COPY --from=build /app/src/mentions.js ./src/mentions.js
COPY --from=build /app/src/notifications.js ./src/notifications.js
COPY --from=build /app/src/people.js ./src/people.js
COPY --from=build /app/src/recordActions.js ./src/recordActions.js

EXPOSE 8080
CMD ["node", "server/index.js"]
