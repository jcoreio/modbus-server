import { createServer, Socket } from 'net'
import ModbusConnection from './ModbusConnection'
import ModbusServer from './ModbusServer'
import PersistanceHandler from './PersistenceHandler'

async function run(): Promise<void> {
  let curConnectionIdx = 0

  const modbusServer: ModbusServer = new ModbusServer()

  let persistenceHandler: PersistanceHandler | undefined
  const saveInterval = parseInt(process.env.SAVE_INTERVAL || '')
  if (saveInterval > 0) {
    persistenceHandler = new PersistanceHandler(
      modbusServer,
      saveInterval * 1000
    )
    try {
      await persistenceHandler.start()
    } catch (err) {
      console.log('could not start persistence handler', err)
    }
  }

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
    socket.on('error', (err: Error) => {
      console.log(`connection ${connectionIdx} got socket error:`, err)
      socket.destroy()
    })
  })

  server.on('error', (err: Error) => {
    console.log('TCP socket server error:', err)
    if (persistenceHandler) {
      console.log('saving state before exiting')
      persistenceHandler
        .save()
        .catch((err2: Error) => {
          console.log('could not save state before exiting:', err2)
        })
        .finally(() => {
          process.exit(1)
        })
    }
  })

  const port = parseInt(process.env.PORT || '') || 502
  server.listen(port)
  console.log(`listening for modbus connections on port ${port}`)
}

run().catch((err: Error) => {
  console.log('uncaught error on startup', err)
  process.exit(1)
})
