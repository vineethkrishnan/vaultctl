.DEFAULT_GOAL := help

BIN         := vaultctl
BIN_DIR     := bin
PKG         := github.com/vineethkrishnan/vaultctl
CMD_SERVER  := ./cmd/server
COVERAGE    := coverage.out

GO          ?= go
GOLANGCI    ?= golangci-lint
GOSEC       ?= gosec
GOVULNCHECK ?= govulncheck
SQLC        ?= sqlc
MIGRATE     ?= migrate

GIT_SHA := $(shell git rev-parse --short HEAD 2>/dev/null || echo dev)
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS := -s -w -X main.version=$(VERSION) -X main.commit=$(GIT_SHA)

.PHONY: help
help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"; printf "Usage:\n  make \033[36m<target>\033[0m\n\nTargets:\n"} /^[a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

.PHONY: build
build: ## Build the vaultctl binary
	@mkdir -p $(BIN_DIR)
	$(GO) build -trimpath -ldflags="$(LDFLAGS)" -o $(BIN_DIR)/$(BIN) $(CMD_SERVER)

.PHONY: run
run: ## Run the server locally
	$(GO) run $(CMD_SERVER)

.PHONY: test
test: ## Run all tests with race detector
	$(GO) test -race -count=1 -coverprofile=$(COVERAGE) ./...

.PHONY: cover
cover: test ## Produce HTML coverage report
	$(GO) tool cover -html=$(COVERAGE) -o coverage.html

.PHONY: lint
lint: ## Run golangci-lint
	$(GOLANGCI) run ./...

.PHONY: lint-fix
lint-fix: ## Run golangci-lint with --fix
	$(GOLANGCI) run --fix ./...

.PHONY: sec
sec: ## Run gosec + govulncheck
	$(GOSEC) -quiet ./...
	$(GOVULNCHECK) ./...

.PHONY: sqlc
sqlc: ## Regenerate sqlc code from queries/
	$(SQLC) generate

.PHONY: migrate-up
migrate-up: ## Apply DB migrations (requires VAULTCTL_DB_* env)
	$(MIGRATE) -path migrations -database "postgres://$${VAULTCTL_DB_USER}:$${VAULTCTL_DB_PASSWORD}@$${VAULTCTL_DB_HOST}:$${VAULTCTL_DB_PORT}/$${VAULTCTL_DB_NAME}?sslmode=$${VAULTCTL_DB_SSL_MODE}" up

.PHONY: migrate-down
migrate-down: ## Roll back one DB migration
	$(MIGRATE) -path migrations -database "postgres://$${VAULTCTL_DB_USER}:$${VAULTCTL_DB_PASSWORD}@$${VAULTCTL_DB_HOST}:$${VAULTCTL_DB_PORT}/$${VAULTCTL_DB_NAME}?sslmode=$${VAULTCTL_DB_SSL_MODE}" down 1

.PHONY: docker-build
docker-build: ## Build the multi-stage Docker image
	docker build -t ghcr.io/vineethkrishnan/vaultctl:$(VERSION) -t ghcr.io/vineethkrishnan/vaultctl:dev .

.PHONY: compose-up
compose-up: ## Start the Caddy + vaultctl + postgres stack
	docker compose up -d

.PHONY: compose-down
compose-down: ## Stop the compose stack
	docker compose down

.PHONY: tidy
tidy: ## Run go mod tidy
	$(GO) mod tidy

.PHONY: clean
clean: ## Remove build artifacts
	rm -rf $(BIN_DIR) dist $(COVERAGE) coverage.html
