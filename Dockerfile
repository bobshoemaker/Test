# Brickhouse server with headless Chromium for draft renders. The Playwright image ships Node and
# the browsers; its version must match the playwright package installed below.
FROM mcr.microsoft.com/playwright:v1.56.1-noble
WORKDIR /app
ENV NODE_ENV=production PORT=10000
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm install --no-save playwright@1.56.1
COPY . .
RUN mkdir -p designs/generated
EXPOSE 10000
CMD ["node", "src/server/server.js"]
