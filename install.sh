#!/bin/bash
# @file install.sh
# @description Provides project automation commands used during setup or maintenance.


# Adytum One-Click Setup
# This script installs dependencies, builds the project, links the CLI, and starts the setup.

set -e

# ANSI Colors
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${CYAN}🚀 Initializing Adytum Setup...${NC}"

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js is not installed. Please install Node.js (>=22) first.${NC}"
    exit 1
fi

# Install dependencies
echo -e "${CYAN}📦 Installing dependencies...${NC}"
npm install

# Build everything
echo -e "${CYAN}🛠️ Building Adytum ecosystem...${NC}"
npm run build

# Link the global command
echo -e "${CYAN}🔗 Registering 'adytum' command globally...${NC}"
(cd packages/gateway && npm link)

# Run initialization if config doesn't exist
if [ ! -f "adytum.config.yaml" ]; then
    echo -e "${GREEN}✨ Starting Birth Protocol (Configuration)...${NC}"
    # Use the local path if link hasn't refreshed in this shell session
    ./node_modules/.bin/tsx packages/gateway/src/cli/index.ts init
else
    echo -e "${YELLOW}✅ Adytum is already configured.${NC}"
fi

echo -e "\n${GREEN}🎉 Setup complete!${NC}"
echo -e "You can now run ${CYAN}adytum start${NC} from any terminal in this directory."
echo -e "Try it now? (y/n)"
read run_start

if [ "$run_start" == "y" ]; then
    ./node_modules/.bin/tsx packages/gateway/src/cli/index.ts start
fi
