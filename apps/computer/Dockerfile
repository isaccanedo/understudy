FROM node:22-bookworm-slim

ARG CLAUDE_CODE_VERSION=2.1.292
ARG CODEX_VERSION=0.160.1
ARG PLAYWRIGHT_MCP_VERSION=0.0.83
ARG HYPERFRAMES_VERSION=0.8.143
ARG POPPINS_COMMIT=8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5

ENV DEBIAN_FRONTEND=noninteractive \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    DISABLE_AUTOUPDATER=1 \
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates tmux git curl tini fonts-noto-color-emoji fonts-liberation \
 && rm -rf /var/lib/apt/lists/*

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      xvfb openbox xdotool x11-utils xauth \
      tint2 picom lxterminal pcmanfm hsetroot papirus-icon-theme gnome-themes-extra \
      libreoffice-writer libreoffice-calc libreoffice-impress \
      python3 python3-pip python3-pandas python3-openpyxl \
      tesseract-ocr tesseract-ocr-eng tesseract-ocr-por \
      pandoc ffmpeg poppler-utils sqlite3 fonts-dejavu-core \
      jq graphviz qpdf libvips-tools potrace qrencode imagemagick xz-utils fontconfig \
      fonts-inter fonts-roboto \
      libgl1 libegl1 libxi6 libxxf86vm1 libxfixes3 libxrender1 libxkbcommon0 libxkbcommon-x11-0 libsm6 libice6 \
 && pip3 install --no-cache-dir --break-system-packages pdfplumber==0.11.4 duckdb==1.3.2 \
 && rm -rf /var/lib/apt/lists/* /root/.cache

RUN npm install -g \
      @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} \
      @openai/codex@${CODEX_VERSION} \
      @playwright/mcp@${PLAYWRIGHT_MCP_VERSION} \
      hyperframes@${HYPERFRAMES_VERSION} \
 && npm cache clean --force

RUN mkdir -p /usr/share/fonts/truetype/poppins \
 && for weight in Regular Medium SemiBold Bold; do \
      curl -fsSL -o "/usr/share/fonts/truetype/poppins/Poppins-$weight.ttf" "https://raw.githubusercontent.com/google/fonts/${POPPINS_COMMIT}/ofl/poppins/Poppins-$weight.ttf"; \
    done \
 && fc-cache -f

RUN corepack enable

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/computer/package.json apps/computer/package.json
COPY apps/host/package.json apps/host/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/characters/package.json packages/characters/package.json
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/runtime/package.json packages/runtime/package.json
RUN pnpm install --frozen-lockfile --prod --filter @understudy/computer... \
 && cd apps/computer \
 && pnpm exec playwright-core install --with-deps chromium \
 && pnpm store prune \
 && rm -rf /var/lib/apt/lists/* /root/.cache /root/.local/share/pnpm
COPY packages/characters/src packages/characters/src
COPY packages/protocol/src packages/protocol/src
COPY packages/runtime/src packages/runtime/src
COPY apps/computer/src apps/computer/src
COPY apps/computer/dev apps/computer/dev

RUN for dir in /etc/opt/chrome_for_testing/policies/managed /etc/opt/chrome/policies/managed /etc/chromium/policies/managed; do \
      mkdir -p "$dir" && printf '%s' '{"URLBlocklist":["file://*"],"AllowFileSelectionDialogs":false,"BrowserSignin":0,"SyncDisabled":true,"PromotionalTabsEnabled":false,"DefaultBrowserSettingEnabled":false,"NewTabPageLocation":"http://127.0.0.1:7690/","HomepageLocation":"http://127.0.0.1:7690/","HomepageIsNewTabPage":false,"ShowHomeButton":true}' > "$dir/understudy.json"; \
    done

RUN userdel -r node 2>/dev/null || true \
 && useradd --create-home --home-dir /home/agent --uid 1000 --shell /bin/bash agent \
 && mkdir -p /run/bench && chown agent:agent /run/bench \
 && mkdir -p /home/agent/files/inbox /home/agent/files/outbox /home/agent/runs /home/agent/memory /home/agent/.understudy \
 && chown -R agent:agent /home/agent

USER agent
ENV HOME=/home/agent \
    PATH=/home/agent/.local/bin:$PATH
WORKDIR /home/agent
VOLUME /home/agent

ARG UNDERSTUDY_VERSION=dev
ENV UNDERSTUDY_VERSION=${UNDERSTUDY_VERSION}

ENTRYPOINT ["tini", "-s", "--"]
CMD ["node", "--experimental-strip-types", "--no-warnings", "/app/apps/computer/src/main.ts"]
