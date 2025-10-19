FROM ubuntu:jammy
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN export DEBIAN_FRONTEND=noninteractive && \
    groupadd -r node && \
    useradd -r -g node node && \
    apt-get update && \
    apt-get install -y --no-install-recommends --no-install-suggests \
      ca-certificates \
      curl \
      gnupg && \
    mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends --no-install-suggests nodejs && \
    npm i -g npm@latest && \
    apt-get -y remove curl gnupg && \
    apt-get -y --purge autoremove && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY package.json package-lock.json ./
COPY patches ./patches
RUN npm ci && \
    chown -R root:root /usr/src/app

COPY . .

RUN mkdir -p /data && \
    chown node:node /data && \
    chmod +x /usr/src/app/docker-entrypoint.sh

VOLUME /data
WORKDIR /data
EXPOSE 3000
USER node:node

ENTRYPOINT ["/usr/src/app/docker-entrypoint.sh"]
