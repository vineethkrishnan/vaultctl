#!/usr/bin/env bash
#
# vaultctl interactive installer
# Usage: curl -fsSL https://vaultctl.vinelab.in/install.sh | bash
#
# End-to-end: installs Docker if missing (Linux or macOS), starts the daemon,
# downloads the source, generates every secret, writes .env, and brings the
# stack up. Prompts are read from the terminal so it works under `curl | bash`.
#
# Non-interactive overrides (export before running to skip the matching prompt):
#   VAULTCTL_INSTALL_DIR   install location              (default: $HOME/vaultctl)
#   VAULTCTL_MODE          1=full-stack(Caddy) 2=simple  (default: ask)
#   VAULTCTL_DOMAIN        domain for full-stack mode
#   VAULTCTL_HOST_PORT     loopback port for simple mode (default: 8080)
#   VAULTCTL_AUTO_INSTALL_DOCKER=y   auto-confirm Docker install
#   VAULTCTL_AUTO_START=y            auto-confirm "start now"
#   VAULTCTL_OVERWRITE_ENV=y         overwrite an existing .env
#   VAULTCTL_NO_DOWNLOAD=1           use the source already in the install dir
#
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

OS="$(uname -s)"

NO_DOCKER=0
for arg in "${@:-}"; do
  case "$arg" in
    --no-docker) NO_DOCKER=1 ;;
    -h|--help)
      cat <<'USAGE'
vaultctl installer

  curl -fsSL https://vaultctl.vinelab.in/install.sh | bash

Options:
  --no-docker   Install the native binary instead of Docker. You supply your
                own PostgreSQL and TLS-terminating reverse proxy.
  -h, --help    Show this help.

See https://vaultctl.vinelab.in for the full guide.
USAGE
      exit 0 ;;
    "") ;;
    *) ;;
  esac
done

print_banner() {
  echo -e "${BLUE}"
  echo "  ============================================"
  echo "  ||                                        ||"
  echo "  ||     vaultctl installer                 ||"
  echo "  ||     Zero-knowledge password vault      ||"
  echo "  ||                                        ||"
  echo "  ============================================"
  echo -e "${NC}"
}

info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
error()   { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# Read interactive input from the controlling terminal so prompts still work
# when the script itself is piped into bash (curl | bash). When no terminal is
# attached, fall back to the supplied default.
read_tty() {
  local __var="$1" __prompt="$2"
  if [ -r /dev/tty ]; then
    read -rp "$__prompt" "$__var" </dev/tty
  else
    eval "$__var=''"
  fi
}

# prompt <message> <default> [ENV_OVERRIDE_VAR]
prompt() {
  local msg="$1" default="${2:-}" override_var="${3:-}" answer=""
  if [ -n "$override_var" ]; then
    local override; override="$(getenv "$override_var")"
    if [ -n "$override" ]; then echo "$override"; return; fi
  fi
  if [ -n "$default" ]; then
    read_tty answer "$(echo -e "${BOLD}$msg${NC} [$default]: ")"
  else
    read_tty answer "$(echo -e "${BOLD}$msg${NC}: ")"
  fi
  echo "${answer:-$default}"
}

# confirm <message> [ENV_OVERRIDE_VAR]
confirm() {
  local msg="$1" override_var="${2:-}" answer=""
  if [ -n "$override_var" ]; then
    local override; override="$(getenv "$override_var")"
    if [ -n "$override" ]; then [[ "$override" =~ ^[Yy] ]]; return; fi
  fi
  read_tty answer "$(echo -e "${BOLD}$msg${NC} [y/N]: ")"
  [[ "$answer" =~ ^[Yy]$ ]]
}

generate_secret() { openssl rand -base64 "$1" | tr -d '\n'; }

# Read an environment variable by name (works on bash 3.2, macOS default).
getenv() { eval "printf '%s' \"\${$1:-}\""; }

ensure_brew_path() {
  local candidate
  for candidate in /opt/homebrew/bin /usr/local/bin; do
    case ":$PATH:" in
      *":$candidate:"*) ;;
      *) [ -d "$candidate" ] && PATH="$candidate:$PATH" ;;
    esac
  done
  export PATH
}

detect_arch() {
  local machine; machine="$(uname -m)"
  case "$machine" in
    x86_64|amd64) echo "amd64" ;;
    arm64|aarch64) echo "arm64" ;;
    *) error "Unsupported architecture: $machine" ;;
  esac
}

latest_version() {
  local tag
  tag="$(curl -fsSL https://api.github.com/repos/vineethkrishnan/vaultctl/releases/latest \
    | grep -m1 '"tag_name"' \
    | sed -E 's/.*"tag_name":[[:space:]]*"([^"]+)".*/\1/')"
  [ -n "$tag" ] || error "Could not determine the latest vaultctl release (GitHub API unreachable?)."
  echo "${tag#v}"
}

sha256_of() {
  if command -v sha256sum &>/dev/null; then sha256sum "$1" | awk '{print $1}'
  elif command -v shasum &>/dev/null; then shasum -a 256 "$1" | awk '{print $1}'
  else echo ""; fi
}

install_binary_mode() {
  command -v curl &>/dev/null || error "curl is required for the binary install"
  command -v tar  &>/dev/null || error "tar is required for the binary install"

  local goos arch ver asset url tmp
  case "$OS" in
    Linux)  goos="linux"  ;;
    Darwin) goos="darwin" ;;
    *) error "Binary install supports Linux and macOS. On Windows, download from the releases page." ;;
  esac
  arch="$(detect_arch)"

  echo ""
  INSTALL_DIR=$(prompt "Installation directory" "$HOME/vaultctl" VAULTCTL_INSTALL_DIR)
  mkdir -p "$INSTALL_DIR"
  cd "$INSTALL_DIR"

  info "Resolving latest release..."
  ver="$(latest_version)"
  asset="vaultctl_${ver}_${goos}_${arch}.tar.gz"
  url="https://github.com/vineethkrishnan/vaultctl/releases/download/v${ver}/${asset}"

  info "Downloading ${asset}..."
  tmp="$(mktemp -d)"
  curl -fsSL "$url" -o "$tmp/${asset}" || error "Download failed: $url"

  if curl -fsSL "https://github.com/vineethkrishnan/vaultctl/releases/download/v${ver}/checksums.txt" -o "$tmp/checksums.txt" 2>/dev/null; then
    local want have
    want="$(grep " ${asset}\$" "$tmp/checksums.txt" | awk '{print $1}' | head -1)"
    have="$(sha256_of "$tmp/${asset}")"
    if [ -n "$want" ] && [ -n "$have" ]; then
      if [ "$want" = "$have" ]; then success "Checksum verified"; else error "Checksum mismatch for ${asset}"; fi
    else
      warn "Could not verify checksum (no sha256 tool or no matching entry); continuing."
    fi
  else
    warn "Could not fetch checksums.txt; skipping integrity check."
  fi

  tar -xzf "$tmp/${asset}" -C "$tmp"
  [ -f "$tmp/vaultctl" ] || error "Archive did not contain a 'vaultctl' binary"
  install -m 0755 "$tmp/vaultctl" "$INSTALL_DIR/vaultctl"
  rm -rf "$tmp"
  success "Installed $INSTALL_DIR/vaultctl ($("$INSTALL_DIR/vaultctl" --version 2>/dev/null | head -1))"

  echo ""
  info "vaultctl needs a PostgreSQL database you provide and manage yourself."
  local db_host db_port db_name db_user db_password db_ssl insecure_ok
  db_host=$(prompt "PostgreSQL host" "localhost" VAULTCTL_DB_HOST)
  db_port=$(prompt "PostgreSQL port" "5432" VAULTCTL_DB_PORT)
  db_name=$(prompt "Database name" "vaultctl" VAULTCTL_DB_NAME)
  db_user=$(prompt "Database user" "vaultctl" VAULTCTL_DB_USER)
  db_password=$(prompt "Database password" "" VAULTCTL_DB_PASSWORD)
  [ -z "$db_password" ] && error "A database password is required."
  db_ssl=$(prompt "DB SSL mode (require|verify-full|disable)" "require" VAULTCTL_DB_SSL_MODE)
  insecure_ok="false"
  [ "$db_ssl" = "disable" ] && insecure_ok="true"

  echo ""
  local domain listen_port base_url
  domain=$(prompt "Public URL host (domain, or 'localhost')" "localhost" VAULTCTL_DOMAIN)
  listen_port=$(prompt "Port the server should listen on" "8080" VAULTCTL_HOST_PORT)
  if [ "$domain" = "localhost" ]; then
    base_url="http://localhost:${listen_port}"
  else
    base_url="https://${domain}"
  fi

  info "Generating cryptographic secrets..."
  local jwt_secret server_pepper enum_pepper data_key
  jwt_secret=$(generate_secret 64)
  server_pepper=$(generate_secret 32)
  enum_pepper=$(generate_secret 32)
  data_key=$(generate_secret 32)

  local config_file="$INSTALL_DIR/config.env"
  cat > "$config_file" << EOF
# vaultctl configuration - generated by installer (--no-docker) on $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# Env-file format: load with 'set -a; . config.env; set +a' or a systemd EnvironmentFile.
VAULTCTL_ENV=production
VAULTCTL_PORT=${listen_port}
VAULTCTL_HOST=0.0.0.0
VAULTCTL_BASE_URL=${base_url}

VAULTCTL_DB_HOST=${db_host}
VAULTCTL_DB_PORT=${db_port}
VAULTCTL_DB_NAME=${db_name}
VAULTCTL_DB_USER=${db_user}
VAULTCTL_DB_PASSWORD=${db_password}
VAULTCTL_DB_SSL_MODE=${db_ssl}
VAULTCTL_DB_SSL_INSECURE_OK=${insecure_ok}

VAULTCTL_JWT_SECRET_CURRENT=${jwt_secret}
VAULTCTL_JWT_KID_CURRENT=k1
VAULTCTL_JWT_ACCESS_TTL=15m
VAULTCTL_JWT_REFRESH_TTL=168h

VAULTCTL_DATA_ENCRYPTION_KEY=${data_key}
VAULTCTL_SERVER_PEPPER=${server_pepper}
VAULTCTL_ENUMERATION_PEPPER=${enum_pepper}

VAULTCTL_REGISTRATION_MODE=open
VAULTCTL_TRUSTED_PROXIES=127.0.0.1/32
VAULTCTL_CORS_ALLOWED_ORIGINS=${base_url}

VAULTCTL_LOG_LEVEL=info
VAULTCTL_LOG_FORMAT=json
EOF
  chmod 600 "$config_file"
  success "Config written to ${config_file} (mode 600)"

  echo ""
  if confirm "Apply database migrations now (requires the DB to be reachable)?" VAULTCTL_AUTO_START; then
    set -a; . "$config_file"; set +a
    if "$INSTALL_DIR/vaultctl" migrate up; then
      success "Database migrations applied"
    else
      warn "Migration failed - verify the DB is reachable, then re-run the migrate command below."
    fi
  fi

  echo ""
  echo -e "${GREEN}================================================${NC}"
  echo -e "${GREEN}  ${BOLD}vaultctl binary installed!${NC}${GREEN}                  ${NC}"
  echo -e "${GREEN}================================================${NC}"
  echo ""
  echo -e "  ${BOLD}Binary:${NC}   ${INSTALL_DIR}/vaultctl"
  echo -e "  ${BOLD}Config:${NC}   ${config_file}"
  echo -e "  ${BOLD}Web vault:${NC} ${base_url}"
  echo ""
  echo -e "  ${YELLOW}Run it:${NC}"
  echo -e "    set -a; . ${config_file}; set +a"
  echo -e "    ${INSTALL_DIR}/vaultctl migrate up      # first run / after upgrades"
  echo -e "    ${INSTALL_DIR}/vaultctl server"
  echo ""
  echo -e "  ${YELLOW}Run as a service (Linux/systemd):${NC} create /etc/systemd/system/vaultctl.service:"
  echo -e "    [Service]"
  echo -e "    EnvironmentFile=${config_file}"
  echo -e "    ExecStart=${INSTALL_DIR}/vaultctl server"
  echo -e "    Restart=always"
  echo ""
  echo -e "  Put a TLS-terminating reverse proxy (Caddy, nginx, Traefik) in front of port ${listen_port}."
  echo -e "  ${BOLD}Documentation:${NC} https://vaultctl.vinelab.in"
  echo ""
}

install_docker() {
  warn "Docker not found."
  if [ "$OS" = "Darwin" ]; then
    if ! command -v brew &>/dev/null; then
      error "Homebrew is required to install Docker on macOS. Install it from https://brew.sh and re-run."
    fi
    if confirm "Install Docker (colima + docker CLI) via Homebrew?" VAULTCTL_AUTO_INSTALL_DOCKER; then
      info "Installing colima, docker, and docker-compose..."
      brew install colima docker docker-compose
      success "Docker toolchain installed"
    else
      error "Docker is required. Install Docker Desktop or 'brew install colima docker'."
    fi
  else
    if confirm "Install Docker via get.docker.com?" VAULTCTL_AUTO_INSTALL_DOCKER; then
      info "Installing Docker..."
      curl -fsSL https://get.docker.com | sh
      sudo systemctl enable --now docker
      sudo usermod -aG docker "$USER" || true
      success "Docker installed. You may need to log out and back in for group changes."
    else
      error "Docker is required. Install it manually: https://docs.docker.com/get-docker/"
    fi
  fi
}

start_docker_daemon() {
  warn "Docker daemon is not running."
  if [ "$OS" = "Darwin" ]; then
    if command -v colima &>/dev/null; then
      info "Starting colima (this can take a minute on first run)..."
      colima start
    elif [ -d "/Applications/Docker.app" ]; then
      info "Starting Docker Desktop..."
      open -a Docker
    else
      error "No Docker runtime found. Start Docker Desktop or run 'colima start'."
    fi
  else
    sudo systemctl start docker || error "Could not start the docker daemon."
  fi
  info "Waiting for the Docker daemon..."
  local i
  for i in $(seq 1 30); do
    if docker info &>/dev/null; then success "Docker daemon is ready"; return; fi
    sleep 2
  done
  error "Docker daemon did not become ready. Check 'colima status' or Docker Desktop."
}

# =========================================================================
print_banner

ensure_brew_path

info "Checking prerequisites..."

if ! command -v openssl &>/dev/null; then
  error "openssl is required for secret generation"
fi

if [ "$NO_DOCKER" = "1" ]; then
  info "Binary install mode (--no-docker): bring your own PostgreSQL and reverse proxy."
  install_binary_mode
  exit 0
fi

if ! command -v docker &>/dev/null; then
  install_docker
fi
success "Docker $(docker --version | awk '{print $3}' | tr -d ',')"

if docker compose version &>/dev/null; then
  DC="docker compose"
elif command -v docker-compose &>/dev/null; then
  DC="docker-compose"
else
  error "Docker Compose not found. Install the compose plugin: https://docs.docker.com/compose/install/"
fi
success "Docker Compose $($DC version --short 2>/dev/null || echo present)"

if ! docker info &>/dev/null; then
  start_docker_daemon
fi

if ! command -v git &>/dev/null && ! command -v curl &>/dev/null; then
  error "git or curl is required to download the source"
fi

echo ""
INSTALL_DIR=$(prompt "Installation directory" "$HOME/vaultctl" VAULTCTL_INSTALL_DIR)
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"
info "Installing to $INSTALL_DIR"

if [ "${VAULTCTL_NO_DOWNLOAD:-0}" = "1" ]; then
  if [ ! -f docker-compose.simple.yml ]; then
    error "VAULTCTL_NO_DOWNLOAD=1 set but no vaultctl source found in $INSTALL_DIR"
  fi
  info "Using existing source in $INSTALL_DIR (download skipped)"
elif [ -d ".git" ]; then
  info "Existing repository found, pulling latest..."
  git pull --ff-only
elif command -v git &>/dev/null; then
  info "Downloading vaultctl..."
  git clone --depth 1 https://github.com/vineethkrishnan/vaultctl.git .
else
  info "Downloading vaultctl..."
  curl -fsSL https://github.com/vineethkrishnan/vaultctl/archive/refs/heads/main.tar.gz | tar xz --strip-components=1
fi
success "Source ready"

echo ""
info "Deployment modes:"
echo -e "  ${BOLD}1)${NC} Full stack - Caddy (auto-TLS) + vaultctl + Postgres (needs a public domain)"
echo -e "  ${BOLD}2)${NC} Simple     - vaultctl + Postgres on 127.0.0.1 (front it with your own proxy)"
echo ""
MODE=$(prompt "Choose mode" "2" VAULTCTL_MODE)

HOST_PORT=8080
if [ "$MODE" = "1" ]; then
  DOMAIN=$(prompt "Your domain (e.g., vault.example.com)" "" VAULTCTL_DOMAIN)
  [ -z "$DOMAIN" ] && error "Full-stack mode requires a domain."
  BASE_URL="https://${DOMAIN}"
  COMPOSE_FILE="docker-compose.yml"
else
  HOST_PORT=$(prompt "Loopback port to expose (127.0.0.1:PORT)" "8080" VAULTCTL_HOST_PORT)
  BASE_URL="http://127.0.0.1:${HOST_PORT}"
  COMPOSE_FILE="docker-compose.simple.yml"
fi

echo ""
info "Generating cryptographic secrets..."
JWT_SECRET=$(generate_secret 64)
SERVER_PEPPER=$(generate_secret 32)
ENUM_PEPPER=$(generate_secret 32)
DATA_KEY=$(generate_secret 32)
DB_PASSWORD=$(openssl rand -hex 16)
success "Secrets generated (JWT 64-byte, peppers + DEK 32-byte each)"

if [ -f .env ]; then
  warn ".env already exists"
  if confirm "Overwrite it?" VAULTCTL_OVERWRITE_ENV; then
    WRITE_ENV=1
  else
    info "Keeping existing .env"
  fi
else
  WRITE_ENV=1
fi

if [ "${WRITE_ENV:-0}" = "1" ]; then
  cat > .env << EOF
# vaultctl configuration - generated by installer on $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# See .env.example for full reference.

# ===========================================================================
# Server
# ===========================================================================
VAULTCTL_ENV=production
VAULTCTL_PORT=8080
VAULTCTL_HOST=0.0.0.0
VAULTCTL_BASE_URL=${BASE_URL}
# Loopback host port published by docker-compose.simple.yml (simple mode only).
VAULTCTL_HOST_PORT=${HOST_PORT}

# ===========================================================================
# Database (individual fields - NOT a connection URL)
# ===========================================================================
VAULTCTL_DB_HOST=vaultctl-db
VAULTCTL_DB_PORT=5432
VAULTCTL_DB_NAME=vaultctl
VAULTCTL_DB_USER=vaultctl
VAULTCTL_DB_PASSWORD=${DB_PASSWORD}
# H12: SSL mode is overridden to 'disable' inside the compose files for the
# loopback container network. Do NOT change this to 'disable' here.
VAULTCTL_DB_SSL_MODE=require

# ===========================================================================
# JWT signing keys - dual-key rotation (H8)
# ===========================================================================
VAULTCTL_JWT_SECRET_CURRENT=${JWT_SECRET}
VAULTCTL_JWT_SECRET_NEXT=
VAULTCTL_JWT_KID_CURRENT=k1
VAULTCTL_JWT_ACCESS_TTL=15m
VAULTCTL_JWT_REFRESH_TTL=168h

# ===========================================================================
# Server-side data encryption key (H5)
# ===========================================================================
VAULTCTL_DATA_ENCRYPTION_KEY=${DATA_KEY}
VAULTCTL_DATA_ENCRYPTION_KEY_NEXT=

# ===========================================================================
# Server peppers (C3 / H7 / H2) - never rotate casually
# ===========================================================================
VAULTCTL_SERVER_PEPPER=${SERVER_PEPPER}
VAULTCTL_ENUMERATION_PEPPER=${ENUM_PEPPER}

# ===========================================================================
# Security
# ===========================================================================
VAULTCTL_REGISTRATION_MODE=open
VAULTCTL_MAX_LOGIN_ATTEMPTS=5
VAULTCTL_LOCKOUT_DURATION=15m
VAULTCTL_RATE_LIMIT_RPM=60
VAULTCTL_AUTH_RATE_LIMIT_PER_EMAIL=5
VAULTCTL_AUTH_RATE_LIMIT_WINDOW=15m
VAULTCTL_STEP_UP_MAX_AGE=5m
VAULTCTL_TRUSTED_PROXIES=127.0.0.1/32,172.16.0.0/12
VAULTCTL_CORS_ALLOWED_ORIGINS=${BASE_URL}

# ===========================================================================
# Retention
# ===========================================================================
VAULTCTL_TRASH_RETENTION_DAYS=30
VAULTCTL_BACKUP_RETENTION_DAYS=90

# ===========================================================================
# Logging
# ===========================================================================
VAULTCTL_LOG_LEVEL=info
VAULTCTL_LOG_FORMAT=json
EOF
  success ".env configured"
fi

if [ "$MODE" = "1" ]; then
  success "Caddy will request a TLS certificate for ${DOMAIN}"
fi

echo ""
if confirm "Start vaultctl now?" VAULTCTL_AUTO_START; then
  info "Starting services with ${COMPOSE_FILE}..."
  $DC -f "$COMPOSE_FILE" pull
  $DC -f "$COMPOSE_FILE" up -d

  info "Applying database migrations..."
  MIGRATED=0
  for i in $(seq 1 30); do
    if $DC -f "$COMPOSE_FILE" exec -T vaultctl /usr/local/bin/vaultctl migrate up &>/dev/null; then
      MIGRATED=1; break
    fi
    sleep 2
  done
  if [ "$MIGRATED" = "1" ]; then
    success "Database migrations applied"
  else
    warn "Could not apply migrations automatically. Run manually once the DB is up:"
    warn "  cd ${INSTALL_DIR} && $DC -f ${COMPOSE_FILE} exec -T vaultctl /usr/local/bin/vaultctl migrate up"
  fi

  info "Waiting for server to be ready..."
  if [ "$MODE" = "1" ]; then
    HEALTH_CMD=($DC -f "$COMPOSE_FILE" exec -T vaultctl /usr/local/bin/vaultctl healthcheck)
  else
    HEALTH_CMD=(curl -sf "http://127.0.0.1:${HOST_PORT}/api/v1/health")
  fi
  READY=0
  for i in $(seq 1 30); do
    if "${HEALTH_CMD[@]}" &>/dev/null; then READY=1; break; fi
    sleep 2
  done

  if [ "$READY" = "1" ]; then
    success "vaultctl is running!"
  else
    warn "Server not yet responding. Check logs: $DC -f ${COMPOSE_FILE} logs -f"
  fi
else
  info "To start later: cd ${INSTALL_DIR} && $DC -f ${COMPOSE_FILE} up -d"
fi

echo ""
echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}  ${BOLD}vaultctl installed successfully!${NC}${GREEN}             ${NC}"
echo -e "${GREEN}================================================${NC}"
echo ""
echo -e "  ${BOLD}Web vault:${NC}    ${BASE_URL}"
if [ "$MODE" = "1" ]; then
  echo -e "  ${BOLD}Health:${NC}       $DC -f ${COMPOSE_FILE} exec -T vaultctl /usr/local/bin/vaultctl healthcheck"
else
  echo -e "  ${BOLD}Health:${NC}       curl http://127.0.0.1:${HOST_PORT}/api/v1/health"
fi
echo -e "  ${BOLD}Logs:${NC}         cd ${INSTALL_DIR} && $DC -f ${COMPOSE_FILE} logs -f"
echo -e "  ${BOLD}Stop:${NC}         cd ${INSTALL_DIR} && $DC -f ${COMPOSE_FILE} down"
echo -e "  ${BOLD}Backup:${NC}       docker exec vaultctl-api /usr/local/bin/vaultctl backup"
echo ""
echo -e "  ${YELLOW}Next steps:${NC}"
echo -e "    1. Open ${BASE_URL} in your browser"
echo -e "    2. Create your account (registration mode is 'open')"
echo -e "    3. Save your recovery kit"
echo -e "    4. Change VAULTCTL_REGISTRATION_MODE to 'invite' in .env"
echo -e "       then restart: $DC -f ${COMPOSE_FILE} restart vaultctl"
echo ""
echo -e "  ${YELLOW}Security note:${NC}"
echo -e "    Your secrets are in ${INSTALL_DIR}/.env"
echo -e "    Back up this file securely - if lost, all encrypted data is unrecoverable."
echo ""
echo -e "  ${BOLD}Documentation:${NC} https://vaultctl.vinelab.in"
echo ""
