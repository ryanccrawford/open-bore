# FRP Server Setup

This script sets up a robust FRP server (`frps`) on an Oracle Cloud instance with Let’s Encrypt SSL.

## Prerequisites
- Oracle Cloud Ubuntu instance (e.g., Free Tier).
- A registered domain (e.g., `example.com`) with DNS A records pointing to your instance’s public IP.

## Installation
1. SSH into your Oracle Cloud instance.
2. Run:
   ```bash
   wget -qO- https://raw.githubusercontent.com/ryanccrawford/server/main/install.sh | bash

3. Follow the interactive prompt to enter your domain.
4. The script:
   - Installs FRP 0.58.0, Certbot, and dependencies.
   - Configures frps with ports 7000 and 443.
   - Obtains Let’s Encrypt certificates.
   - Sets up systemd services and a watchdog.
   - Opens iptables for 7000 and 443.

## Post-Installation
- VCN Security List: In Oracle Cloud Console, add ingress rules:
  - TCP, Port 7000, Source 0.0.0.0/0.
  - TCP, Port 443, Source 0.0.0.0/0.
- Check Status: sudo systemctl status frps.
- Logs: journalctl -u frps.service or /var/log/frps.log.

## Troubleshooting
- Certbot failure? Verify DNS propagation (dig A yourdomain.com).
- Not starting? Check logs and VCN rules.
