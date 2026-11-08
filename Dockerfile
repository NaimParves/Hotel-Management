# Board server for Render.com (cloud mode). Image already contains Chromium for Playwright 1.65.0.
FROM mcr.microsoft.com/playwright:v1.65.0-noble
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 NODE_ENV=production CLOUD=1
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js everest-scrape.js index.html ./
EXPOSE 3000
CMD ["node", "server.js"]
