#!/bin/bash

echo "Installing Open Bore Client..."

# Detect platform
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
case "$OS" in
  linux)
    if [ "$ARCH" = "x86_64" ]; then
      BINARY="open-bore-linux"
    else
      echo "Unsupported architecture: $ARCH (only x86_64 supported)"
      exit 1
    fi
    ;;
  darwin)
    if [ "$ARCH" = "x86_64" ]; then
      BINARY="open-bore-macos"
    else
      echo "Unsupported architecture: $ARCH (only x86_64 supported)"
      exit 1
    fi
    ;;
  msys*|cygwin*|mingw*|win*)
    BINARY="open-bore-win.exe"
    ;;
  *)
    echo "Unsupported OS: $OS"
    exit 1
    ;;
esac

# Download latest release binary
RELEASE_URL="https://github.com/ryanccrawford/open-bore/releases/latest/download/$BINARY"
wget -O open-bore "$RELEASE_URL"
chmod +x open-bore

# Prompt for config
read -p "Enter your server domain (e.g., yourdomain.com): " DOMAIN
read -p "Enter your server token: " TOKEN
cat << EOF > open-bore.ini
[common]
server_addr = $DOMAIN
server_port = 7000
token = $TOKEN
EOF

echo "Client installed!"
echo "Run CLI: ./open-bore -s <subdomain> -p <localPort> [-showspeed]"