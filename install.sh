#!/bin/bash
# @file install.sh
# @description One-click installer for Adytum (Mac/Linux).

set -e

# ANSI Colors
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${CYAN}🚀 Initializing Adytum Setup...${NC}"

# 1. Handle Remote Execution / Cloning
if [ ! -f "package.json" ] || ! grep -q '"name": "adytum"' package.json; then
    if [ -d "adytum" ]; then
        echo -e "${YELLOW}📂 Found 'adytum' directory. Entering...${NC}"
        cd adytum
    else
        echo -e "${CYAN}📂 Cloning Adytum repository...${NC}"
        if ! command -v git &> /dev/null; then
            echo -e "${RED}❌ Git is not installed. Please install git first.${NC}"
            exit 1
        fi
        git clone https://github.com/dewminaudayashan/adytum.git
        cd adytum
    fi
fi

# 2. Check for Node.js (>=22)
check_node() {
    if command -v node &> /dev/null; then
        NODE_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
        if [ "$NODE_VER" -ge 22 ]; then
            return 0
        fi
    fi
    return 1
}

if ! check_node; then
    echo -e "${YELLOW}⏳ Node.js >= 22 not found. Attempting automatic installation...${NC}"
    OS="$(uname -s)"
    case "${OS}" in
        Darwin*)
            if command -v brew &> /dev/null; then
                echo -e "${CYAN}🍺 Using Homebrew to install Node.js...${NC}"
                brew install node
            else
                echo -e "${RED}❌ Homebrew not found. Please install Node.js manually: https://nodejs.org/${NC}"
                exit 1
            fi
            ;;
        Linux*)
            if command -v apt-get &> /dev/null; then
                echo -e "${CYAN}📦 Using apt to install Node.js...${NC}"
                curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
                sudo apt-get install -y nodejs
            else
                echo -e "${RED}❌ Automatic installation not supported for this distro. Please install Node.js >= 22 manually.${NC}"
                exit 1
            fi
            ;;
        *)
            echo -e "${RED}❌ Unsupported OS for automatic Node.js installation.${NC}"
            exit 1
            ;;
    esac
fi

# Final check
if ! check_node; then
    echo -e "${RED}❌ Node.js installation failed or version still too low. Please install Node.js 22+ manually.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Node.js $(node -v) detected.${NC}"

# 3. Install dependencies
echo -e "${CYAN}📦 Installing dependencies...${NC}"
npm install

# 4. Build everything
echo -e "${CYAN}🛠️ Building Adytum ecosystem...${NC}"
npm run build

# 5. Link the global command
echo -e "${CYAN}🔗 Registering 'adytum' command locally...${NC}"
# We use a local alias if link fails or for immediate use
ADYTUM_BIN="$(pwd)/packages/gateway/dist/cli/index.js"
chmod +x "$ADYTUM_BIN"

# 6. Run initialization
echo -e "${GREEN}✨ Starting Birth Protocol (Configuration)...${NC}"
node "$ADYTUM_BIN" init

# 7. Ask to start
echo -e "\n${GREEN}🎉 Setup complete!${NC}"
echo -e "Try running Adytum now? (y/n)"
read -r run_start

if [[ "$run_start" =~ ^[Yy]$ ]]; then
    node "$ADYTUM_BIN" start
else
    echo -e "\nYou can start Adytum anytime by running: ${CYAN}node $ADYTUM_BIN start${NC}"
    echo -e "Or link it globally: ${CYAN}cd packages/gateway && npm link${NC}"
fi
