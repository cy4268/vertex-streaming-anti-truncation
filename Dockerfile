FROM node:24-bookworm-slim

LABEL org.opencontainers.image.source="https://github.com/ken050210/vertex-streaming-anti-truncation" \
      org.opencontainers.image.title="Vertex Streaming Anti-Truncation" \
      org.opencontainers.image.description="Vertex Gemini gateway with a web console and streaming text restoration" \
      org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production \
    LISTEN_HOST=0.0.0.0 \
    GUI_PORT=4780 \
    PORT=4781 \
    GATEWAY_STATE_DIR=/data
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY bin/ ./bin/
COPY src/ ./src/
COPY public/ ./public/
COPY assets/fonts/ ./assets/fonts/
COPY LICENSE NOTICE.md NOTICE.zh-CN.md ./
COPY LICENSES/ ./LICENSES/

RUN mkdir -p /data && chown node:node /data && chmod 700 /data
USER node
EXPOSE 4780 4781
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "bin/healthcheck.mjs"]
CMD ["node", "bin/gui.mjs"]
