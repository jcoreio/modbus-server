#!/usr/bin/env bash
set -euxo pipefail
cd "$(dirname "$0")"
INSTALL_DIR=/opt/modbus-server
mkdir -p $INSTALL_DIR
cp -R lib $INSTALL_DIR
chown -R root $INSTALL_DIR
cp modbus-server.service /etc/systemd/system
systemctl enable modbus-server
systemctl start modbus-server
