# modbus-server

modbus server that allows writes and read-backs

## Installation

Download the latest tar.bz distribution bundle from [the modbus-server releases page](https://github.com/jcoreio/modbus-server/releases)

Unpack the bundle:

```shell
tar xf modbus-server-v1.0.0.tar.bz2
```

Run the `install.sh` script with `sudo`:

```shell
sudo ./modbus-server/install
```

To check that the server is running:

```shell
sudo systemctl status modbus-server
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

Generate a distribution bundle:

```shell
./run bundle
```
