#!/usr/bin/env bash
# Collabrix — One-command setup
# Usage: ./scripts/collabrix-setup.sh
set -e

BOLD="\033[1m"
GREEN="\033[32m"
CYAN="\033[36m"
RED="\033[31m"
RESET="\033[0m"

log()  { echo -e "${CYAN}[collabrix]${RESET} $1"; }
ok()   { echo -e "${GREEN}[✓]${RESET} $1"; }
fail() { echo -e "${RED}[✗]${RESET} $1"; exit 1; }

echo -e "\n${BOLD}Collabrix Setup${RESET}\n"

# ── Prerequisites check ──────────────────────────────────────────
command -v node  >/dev/null 2>&1 || fail "Node.js not found. Install v22+ from https://nodejs.org"
command -v npm   >/dev/null 2>&1 || fail "npm not found."
NODE_VER=$(node -e "process.stdout.write(process.versions.node)")
log "Node.js $NODE_VER detected"

# ── Server setup ─────────────────────────────────────────────────
log "Installing server dependencies..."
npm install --prefix extensions/collab-edit/collab-server
ok "Server deps installed"

log "Building server..."
npm run build --prefix extensions/collab-edit/collab-server
ok "Server built"

# ── Extension setup ───────────────────────────────────────────────
log "Installing extension dependencies..."
npm install --prefix extensions/collab-edit
ok "Extension deps installed"

log "Compiling extension..."
npm run compile --prefix extensions/collab-edit
ok "Extension compiled"

# ── Package VSIX ─────────────────────────────────────────────────
if command -v vsce >/dev/null 2>&1; then
  log "Packaging extension as VSIX..."
  (cd extensions/collab-edit && vsce package --no-dependencies -o collab-edit-latest.vsix 2>&1) && ok "VSIX built: extensions/collab-edit/collab-edit-latest.vsix"
else
  log "vsce not found — skipping VSIX packaging (run: npm install -g @vscode/vsce)"
fi

# ── Done ─────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Setup complete.${RESET}"
echo ""
echo -e "  Start the server:   ${CYAN}npm start --prefix extensions/collab-edit/collab-server${RESET}"
echo -e "  Launch Collabrix:   ${CYAN}./scripts/code.sh${RESET}"
echo -e "  Then open Command Palette → ${BOLD}Collab: Create Collaboration Room${RESET}"
echo ""
