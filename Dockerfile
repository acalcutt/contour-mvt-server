FROM ubuntu:jammy AS builder

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN export DEBIAN_FRONTEND=noninteractive && \
    apt-get update && \
    apt-get install -y --no-install-recommends --no-install-suggests \
      build-essential \
      ca-certificates \
      curl \
    mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list && \
    apt-get -qq update && \
    apt-get install -y --no-install-recommends --no-install-suggests nodejs && \
    npm i -g npm@latest && \
    apt-get -y remove curl gnupg && \
    apt-get -y --purge autoremove && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

RUN mkdir -p /usr/src/app

WORKDIR /usr/src/app

COPY package.json /usr/src/app
COPY package-lock.json /usr/src/app

RUN npm ci && \
    chown -R root:root /usr/src/app

FROM ubuntu:jammy AS final

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN export DEBIAN_FRONTEND=noninteractive && \
    groupadd -r node && \
    useradd -r -g node node && \
    apt-get -qq update && \
    apt-get install -y --no-install-recommends --no-install-suggests \
      ca-certificates \
      curl \
    mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list && \
    apt-get -qq update && \
    apt-get install -y --no-install-recommends --no-install-suggests nodejs && \
    npm i -g npm@latest && \
    apt-get -y remove curl gnupg && \
    apt-get -y --purge autoremove && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

COPY --from=builder /usr/src/app /usr/src/app

COPY . /usr/src/app

RUN mkdir -p /data && chown node:node /data
VOLUME /data
WORKDIR /data

EXPOSE 3000

USER node:node

ENTRYPOINT ["/usr/src/app/docker-entrypoint.sh"]
