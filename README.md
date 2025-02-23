# Open Bore

A custom tunneling client built in TypeScript, wrapping the FRP (`frpc`) client to expose local services securely via a public FRP server. Binaries include `frpc` v0.58.0—no separate downloads needed.

## Features
- **Secure Tunneling**: Maps local ports to public subdomains over HTTPS.
- **Speed Monitoring**: Logs basic throughput (extendable for tunnel stats).
- **Cross-Platform**: Single executable for Linux, macOS.
- **Easy Install**: Script creates config file (`open-bore.ini`) with user input.

## Installation

### Via Install Script (Linux/macOS)
```bash
wget -qO- https://raw.githubusercontent.com/ryanccrawford/open-bore/main/client/install.sh | bash
```
- Prompts for server domain (e.g., easydevfrp.com) and token.
- Downloads open-bore-<platform> and creates open-bore.ini.
  
## Manual Download
- Grab the latest release from https://github.com/ryanccrawford/open-bore/releases GitHub Releases.
- Create open-bore.ini:
```ini
[common]
server_addr = yourdomain.com
server_port = 7000
token = your-token-here
```

## Usage
### CLI
```bash
./open-bore -s <subdomain> -p <localPort> [-showspeed]
```
- -s, --subdomain: Required subdomain (e.g., ryan).
- -p, --port: Local port (default: 3000).
- --showspeed: Display speed stats (stdout/stderr throughput).
### Example with Config File
```bash
./open-bore -s ryan -p 3000 -showspeed
```

### Example with CLI Args
```bash
./open-bore -s ryan -p 3000 --server-addr easydevfrp.com --server-port 7000 --token your-token-here -showspeed
```

### Development
```bash
npm install
npm run start:dev -- -s ryan -p 3000 -showspeed
```
- Requires frpc v0.58.0 in root or .env/open-bore.ini.

### Configuration
- .env (dev):
- ```text
OPEN_BORE_SERVER_ADDR=easydevfrp.com
OPEN_BORE_SERVER_PORT=7000
OPEN_BORE_TOKEN=your-token-here
  ```

- open-bore.ini (runtime):
```ini
[common]
server_addr = easydevfrp.com
server_port = 7000
token = your-token-here
```
## Building Binaries
```bash
npm run build
npm run pkg
```
- Outputs: client/open-bore-linux, client/open-bore-macos.
- Bundles client/frpc-linux, client/frpc-macos.

## Prerequisites
- FRP Server: Running frps v0.58.0 (e.g., on easydevfrp.com:7000) See Readme.me in the server folder for mor information.
- Node.js: v18+ for dev/build.

### Example

1. Start a local server:
```bash
node -e "require('http').createServer((req, res) => res.end('Hello')).listen(3000)"
```
2. Run Open Bore:
```bash
./open-bore -s ryan -p 3000 -showspeed
```

3. Access: https://ryan.easydevfrp.com → "Hello".

## License
MIT License - see LICENSE (add if applicable).

## Contributing
Pull requests welcome! For major changes, open an issue first.

## Author
Ryan Crawford
