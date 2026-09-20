# syntax=docker/dockerfile:1

ARG UBUNTU_VERSION=26.04
ARG NODE_MAJOR=24


# ---------------------------------------------------------------------------
# Stage 1 - build sfp from the local working tree into an installable tarball
# ---------------------------------------------------------------------------
FROM node:${NODE_MAJOR}-trixie-slim AS sfp-builder

ENV DEBIAN_FRONTEND=noninteractive
ENV HUSKY=0

# better-sqlite3 (via @flxbl-io/sfprofiles) ships no prebuilt binary for the
# node 24+ ABI, so npm ci falls back to node-gyp and needs a toolchain
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /sfp

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN mkdir -p /dist \
    && npm run build \
    && npm run manifest \
    && npm pack --pack-destination /dist


# ---------------------------------------------------------------------------
# Stage 2 - runtime image
# ---------------------------------------------------------------------------
FROM ubuntu:${UBUNTU_VERSION}

ARG NODE_MAJOR
ARG TARGETARCH
ARG SF_CLI_VERSION=2.150.6
ARG SFDMU_VERSION=4.38.0
ARG JAVA_MAJOR=25
ARG GIT_COMMIT

LABEL org.opencontainers.image.description "sfp is a build system for modular development in Salesforce."
LABEL org.opencontainers.image.licenses "MIT"
LABEL org.opencontainers.image.url "https://github.com/flxbl-io/sfp"
LABEL org.opencontainers.image.documentation "https://docs.flxbl.io/sfp"
LABEL org.opencontainers.image.revision $GIT_COMMIT
LABEL org.opencontainers.image.vendor "Flxbl"
LABEL org.opencontainers.image.source "https://github.com/flxbl-io/sfp"
LABEL org.opencontainers.image.title "Flxbl sfp docker image - December 24"


ENV DEBIAN_FRONTEND=noninteractive


RUN ln -sf bash /bin/sh


# the JRE is required by @flxbl-io/apexlink, which shells out to its own jars
RUN apt-get update && \
    apt-get -y install --no-install-recommends \
    jq \
    zip \
    unzip \
    curl \
    wget \
    git \
    tzdata \
    openjdk-${JAVA_MAJOR}-jre-headless && \
    apt-get autoremove -y && \
    apt-get clean -y && \
    rm -rf /var/lib/apt/lists/*

# Set timezone to UTC
ENV TZ=UTC
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# Install Node.js and the toolchain node-gyp needs for better-sqlite3
RUN apt-get update && \
    apt-get upgrade -y && \
    apt-get -y install --no-install-recommends \
      make \
      ca-certificates \
      gcc \
      g++ \
      python3 \
      gnupg \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get -y install --no-install-recommends nodejs \
    && apt-get autoremove --assume-yes \
    && apt-get clean --assume-yes \
    && rm -rf /var/lib/apt/lists/*

# npm >=11.19 blocks install scripts unless a package is explicitly allowed
RUN npm install --global --omit-dev --allow-scripts=yarn yarn \
    && npm cache clean --force

# Install SF cli and the locally built sfp
# better-sqlite3 (via @flxbl-io/sfprofiles) must compile or sfp fails at runtime
COPY --from=sfp-builder /dist/*.tgz /tmp/sfp.tgz
RUN npm install --global --omit=dev \
    --allow-scripts=better-sqlite3,unix-dgram,protobufjs,@salesforce/cli \
    @salesforce/cli@${SF_CLI_VERSION} \
    /tmp/sfp.tgz \
    && rm -f /tmp/sfp.tgz \
    && npm cache clean --force



# Set XDG environment variables explicitly so that GitHub Actions does not apply
# default paths that do not point to the plugins directory
# https://specifications.freedesktop.org/basedir-spec/basedir-spec-latest.html
ENV XDG_DATA_HOME=/sf_plugins/.local/share \
    XDG_CONFIG_HOME=/sf_plugins/.config  \
    XDG_CACHE_HOME=/sf_plugins/.cache \
    JAVA_HOME=/usr/lib/jvm/java-${JAVA_MAJOR}-openjdk-${TARGETARCH}


# Create symbolic link from sh to bash
# Create isolated plugins directory with rwx permission for all users
# Azure pipelines switches to a container-user which does not have access
# to the root directory where plugins are normally installed
RUN mkdir -p $XDG_DATA_HOME && \
    mkdir -p $XDG_CONFIG_HOME && \
    mkdir -p $XDG_CACHE_HOME && \
    chmod -R 777 sf_plugins && \
    export JAVA_HOME && \
    export XDG_DATA_HOME && \
    export XDG_CONFIG_HOME && \
    export XDG_CACHE_HOME



# Install sfdx plugins
RUN echo 'y' | sf plugins:install sfdmu@${SFDMU_VERSION} \
    && yarn cache clean --all

# Set some sane behaviour in container
ENV SF_CONTAINER_MODE=true
ENV SF_DISABLE_AUTOUPDATE=true
ENV SF_DISABLE_TELEMETRY=true
ENV SF_USE_GENERIC_UNIX_KEYCHAIN=true
ENV SF_USE_PROGRESS_BAR=false
ENV SF_DNS_TIMEOUT=60000
ENV SF_SKIP_VERSION_CHECK=true
ENV SF_SKIP_NEW_VERSION_CHECK=true

WORKDIR /root



# clear the entrypoint for azure
ENTRYPOINT []
CMD ["/bin/sh"]
