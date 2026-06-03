# syntax=docker/dockerfile:1.7
#
# Multi-stage build for vaultctl.
#   Stage 1 (web):     Node toolchain compiles the SPA into web/dist.
#   Stage 2 (builder): Go toolchain embeds web/dist and compiles the binary.
#   Stage 3 (runtime): distroless image carrying only the binary + ca-certs.
#
# Target final image: < 50MB (see architecture §14 DoD).

# ===========================================================================
# Stage 1: Web bundle
# ===========================================================================
FROM node:26-alpine AS web

WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN npm ci

COPY web/ ./
RUN npm run build

# ===========================================================================
# Stage 2: Build
# ===========================================================================
FROM golang:1.26.4-alpine AS builder

WORKDIR /src

COPY go.mod go.sum* ./
RUN go mod download

COPY . .
COPY --from=web /web/dist ./web/dist

ARG VERSION=dev
ARG COMMIT=dev

ENV CGO_ENABLED=0 GOOS=linux
RUN go build \
      -trimpath \
      -ldflags="-s -w \
        -X github.com/vineethkrishnan/vaultctl/internal/presenters/cli.Version=${VERSION} \
        -X github.com/vineethkrishnan/vaultctl/internal/presenters/cli.Commit=${COMMIT}" \
      -o /out/vaultctl \
      ./cmd/server

# Pre-create the attachments dir owned by the distroless nonroot uid (65532)
# so a named volume mounted there inherits writable ownership on first init.
RUN mkdir -p /seed/data/attachments && chown -R 65532:65532 /seed/data

# ===========================================================================
# Stage 3: Runtime (distroless)
# ===========================================================================
FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=builder /out/vaultctl /usr/local/bin/vaultctl
COPY --from=builder --chown=65532:65532 /seed/data /data

USER nonroot:nonroot
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["/usr/local/bin/vaultctl", "healthcheck"]

ENTRYPOINT ["/usr/local/bin/vaultctl"]
CMD ["server"]
