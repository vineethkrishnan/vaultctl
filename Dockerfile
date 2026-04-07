# syntax=docker/dockerfile:1.7
#
# Multi-stage build for vaultctl.
#   Stage 1 (builder): compile the Go binary with CGO disabled.
#   Stage 2 (runtime): distroless image carrying only the binary + ca-certs.
#
# Target final image: < 50MB (see architecture §14 DoD).

# ===========================================================================
# Stage 1: Build
# ===========================================================================
FROM golang:1.26-alpine AS builder

WORKDIR /src

# Cache module downloads separately from source
COPY go.mod go.sum* ./
RUN go mod download

COPY . .

ARG VERSION=dev
ARG COMMIT=dev

ENV CGO_ENABLED=0 GOOS=linux
RUN go build \
      -trimpath \
      -ldflags="-s -w -X main.version=${VERSION} -X main.commit=${COMMIT}" \
      -o /out/vaultctl \
      ./cmd/server

# ===========================================================================
# Stage 2: Runtime (distroless)
# ===========================================================================
FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=builder /out/vaultctl /usr/local/bin/vaultctl

USER nonroot:nonroot
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["/usr/local/bin/vaultctl", "healthcheck"]

ENTRYPOINT ["/usr/local/bin/vaultctl"]
