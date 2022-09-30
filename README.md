# modbus-server

Lightweight zero-dependency Modbus TCP server that allows writes and read-backs across the holding
register space. Useful for communicating between two devices that only support Modbus TCP client
communications.

Runs as an OS service on the [JCore Iron Pi](https://www.jcore.io/iron-pi) and most
other devices with a modern Linux OS and [Node.js](https://nodejs.org/en/download/) version 10 or newer
runtime.

Mirrors all holding registers to the input register space. Accessing to discrete inputs and outputs is not
currently supported.

When running as a service, saves register values to disk once per minute so that register values persist across
restarts.

## Installation

Download the latest release onto your device:

```shell
wget https://github.com/jcoreio/modbus-server/releases/download/v1.0.0/modbus-server-v1.0.0.tar.bz2
```

Unpack the bundle:

```shell
tar xf modbus-server-v1.0.0.tar.bz2
```

Run the `install.sh` script with `sudo`:

```shell
sudo ./modbus-server/install.sh
```

To check that the server is running:

```shell
sudo systemctl status modbus-server
```

You should see something like:

```
● modbus-server.service - Modbus Server
   Loaded: loaded (/etc/systemd/system/modbus-server.service; enabled; vendor preset: enabled)
   Active: active (running) since Fri 2022-09-30 16:33:54 CDT; 21s ago
 Main PID: 6212 (node)
    Tasks: 11 (limit: 2062)
   CGroup: /system.slice/modbus-server.service
           └─6212 /usr/local/bin/node /opt/modbus-server/lib/index.js

Sep 30 16:33:54 raspberrypi systemd[1]: Started Modbus Server.
Sep 30 16:33:55 raspberrypi node[6212]: creating data directory: /opt/modbus-server/data
Sep 30 16:33:55 raspberrypi node[6212]: listening for modbus connections on port 502
Sep 30 16:33:56 raspberrypi node[6212]: client 1 connected
```

To start or stop the server:

```shell
sudo systemctl stop modbus-server
sudo systemctl start modbus-server
```

To enable or disable starting on boot:

```shell
sudo systemctl enable modbus-server
sudo systemctl disable modbus-server
```

## Development

### Requirements

Development requires [Node.js](https://nodejs.org/en/download/) and the [pnpm](https://pnpm.io/) package manager.

### Getting Started

Install the project and its dependencies:

```shell
git clone https://github.com/jcoreio/modbus-server.git
cd modbus-server
pnpm install
./run build
./run bundle
```

Run all checks and format the code:

```shell
./run prep
```
