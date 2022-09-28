import { createServer, Socket } from 'net'
import ModbusConnection from './ModbusConnection'
import ModbusServer from './ModbusServer'

let curConnectionIdx = 0

const modbusServer: ModbusServer = new ModbusServer()

const server = createServer((socket: Socket) => {
  const connectionIdx = ++curConnectionIdx
  console.log(`client ${connectionIdx} connected`)
  const connection = new ModbusConnection({
    modbusServer,
    writePacketCallback: socket.write.bind(socket),
  })
  socket.on('data', (buf: Buffer) => {
    try {
      connection.onData(buf)
    } catch (err) {
      console.log(
        `connection ${connectionIdx}: error handling modbus message`,
        err
      )
      socket.destroy()
    }
  })
})

server.on('error', (err: Error) => {
  console.error('server error:', err)
  process.exit(1)
})

const port = parseInt(process.env.PORT || '') || 502
server.listen(port)
console.log(`listening for modbus connections on port ${port}`)
