#!/bin/bash

echo "Getting FRPC Linux..."
wget https://github.com/fatedier/frp/releases/download/v0.58.0/frp_0.58.0_linux_amd64.tar.gz
tar -xzf frp_0.58.0_linux_amd64.tar.gz
mv frp_0.58.0_linux_amd64/frpc frpc-linux
chmod +x frpc-linux
rm -rf frp_0.58.0_linux_amd64*

echo "Getting FRPC Mac OS..."
wget https://github.com/fatedier/frp/releases/download/v0.58.0/frp_0.58.0_darwin_amd64.tar.gz
tar -xzf frp_0.58.0_darwin_amd64.tar.gz
mv frp_0.58.0_darwin_amd64/frpc frpc-macos
chmod +x frpc-macos
rm -rf frp_0.58.0_darwin_amd64*
