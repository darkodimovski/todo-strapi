# Strapi backend – production image
FROM node:20-bookworm-slim

# build tools for native modules (better-sqlite3)
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
ENV NODE_ENV=production
RUN npm run build

EXPOSE 1337
CMD ["npm", "run", "start"]
