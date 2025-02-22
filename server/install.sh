#!/bin/bash

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo "Please run as root (sudo)"
  exit 1
fi

echo "Welcome to the FRP Server Setup!"

# Prompt for domain
read -p "Enter your domain (e.g., easydevfrp.com): " DOMAIN
if [ -z "$DOMAIN" ]; then
  echo "Domain cannot be empty!"
  exit 1
fi

# Prompt for custom token (optional)
read -p "Enter a custom token (leave blank for random): " CUSTOM_TOKEN
if [ -z "$CUSTOM_TOKEN" ]; then
  # Generate a random 32-character token
  TOKEN=$(head /dev/urandom | tr -dc A-Za-z0-9 | head -c 32)
  echo "Generated random token: $TOKEN"
else
  TOKEN="$CUSTOM_TOKEN"
  echo "Using custom token: $TOKEN"
fi

# Install dependencies
echo "Installing dependencies..."
apt update
apt install -y wget git certbot nginx iptables-persistent

# Download FRP
echo "Downloading FRP 0.58.0..."
wget https://github.com/fatedier/frp/releases/download/v0.58.0/frp_0.58.0_linux_amd64.tar.gz
tar -xzf frp_0.58.0_linux_amd64.tar.gz
mv frp_0.58.0_linux_amd64/frps /usr/local/bin/
rm -rf frp_0.58.0_linux_amd64*

# Create config directory and file with token
mkdir -p /etc/frp
cat << EOF > /etc/frp/frps.ini
[common]
bind_port = 7000
vhost_https_port = 443
token = $TOKEN
log_file = /var/log/frps.log
log_level = info
log_max_days = 7
EOF

# Set up Let’s Encrypt
echo "Setting up Let’s Encrypt for $DOMAIN..."
certbot certonly --nginx -d "$DOMAIN" -d "*.$DOMAIN" --non-interactive --agree-tos -m "admin@$DOMAIN"
if [ $? -eq 0 ]; then
  echo "Certificates obtained!"
  echo "tls_cert_file = /etc/letsencrypt/live/$DOMAIN/fullchain.pem" >> /etc/frp/frps.ini
  echo "tls_key_file = /etc/letsencrypt/live/$DOMAIN/privkey.pem" >> /etc/frp/frps.ini
else
  echo "Failed to obtain certificates. Check domain DNS and try again."
  exit 1
fi

# Create systemd service
cat << EOF > /etc/systemd/system/frps.service
[Unit]
Description=FRP Server Service
After=network.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/frps -c /etc/frp/frps.ini
Restart=always
RestartSec=5s
StartLimitInterval=0
TimeoutStopSec=10
ExecStop=/bin/kill -s QUIT \$MAINPID
ExecReload=/bin/kill -s HUP \$MAINPID
LimitNOFILE=65535
Environment="FRP_LOG_LEVEL=info"

[Install]
WantedBy=multi-user.target
EOF

# Create watchdog
cat << EOF > /usr/local/bin/frps-watchdog.sh
#!/bin/bash
while true; do
  if ! ss -tuln | grep -q ":7000"; then
    echo "Port 7000 not listening, restarting frps..."
    systemctl restart frps
  fi
  sleep 30
done
EOF
chmod +x /usr/local/bin/frps-watchdog.sh

cat << EOF > /etc/systemd/system/frps-watchdog.service
[Unit]
Description=FRP Server Watchdog
After=frps.service

[Service]
Type=simple
ExecStart=/usr/local/bin/frps-watchdog.sh
Restart=always
RestartSec=10s

[Install]
WantedBy=multi-user.target
EOF

# Open firewall
iptables -I INPUT 6 -p tcp --dport 7000 -j ACCEPT
iptables -I INPUT 7 -p tcp --dport 443 -j ACCEPT
iptables-save | tee /etc/iptables/rules.v4

# Enable and start services
systemctl daemon-reload
systemctl enable frps frps-watchdog iptables-persistent
systemctl start frps frps-watchdog

echo "FRP Server installed!"
echo "Token: $TOKEN (Save this for your client config!)"
echo "Check status with: sudo systemctl status frps"
echo "Note: In Oracle Cloud Console, add VCN Security List ingress rules for TCP 7000 and 443."