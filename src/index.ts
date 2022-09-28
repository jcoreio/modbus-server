import { createServer, Socket } from 'net'

const MODBUS_FN_CODE_READ_DISCRETE_OUTPUTS = 1
const MODBUS_FN_CODE_READ_DISCRETE_INPUTS = 2
const MODBUS_FN_CODE_READ_OUTPUT_REGS = 3
const MODBUS_FN_CODE_READ_INPUT_REGS = 4
const MODBUS_FN_CODE_WRITE_SINGLE_COIL = 5
const MODBUS_FN_CODE_WRITE_SINGLE_REG = 6
const MODBUS_FN_CODE_WRITE_MULTIPLE_DISCRETE = 15
const MODBUS_FN_CODE_WRITE_MULTIPLE_REGS = 16

const MODBUS_LEN_EXTRA = 2
const MODBUS_TCP_HEADER_LEN = 8

const MODBUS_ADDRESSES_PER_OP = 10000

const numericRegs: Buffer = Buffer.alloc(MODBUS_ADDRESSES_PER_OP * 2) // 16 bits per reg
const coils: Buffer = Buffer.alloc(MODBUS_ADDRESSES_PER_OP / 8) // 8 coils per byte

const ADDRESS_AND_REG_COUNT_OVERHEAD = 4

function readStartAddressAndRegCount(
  buf: Buffer
): { startAddress: number; regCount: number } {
  if (buf.length < ADDRESS_AND_REG_COUNT_OVERHEAD)
    throw Error(
      `data buffer is too short to read address and register count: got ${buf.length}, must be at least 4`
    )
  return {
    startAddress: buf.readUInt16BE(0),
    regCount: buf.readUInt16BE(2),
  }
}

function handleReadMultipleRegs(rxData: Buffer): Buffer {
  const { startAddress, regCount } = readStartAddressAndRegCount(rxData)
  const response = Buffer.alloc(regCount * 2 + 1)
  response.writeUInt8(regCount * 2)
  numericRegs.copy(response, 1, startAddress * 2, (startAddress + regCount) * 2)
  return response
}

function getWriteAckResponse({
  startAddress,
  regCount,
}: {
  startAddress: number
  regCount: number
}): Buffer {
  const data = Buffer.alloc(4)
  data.writeUInt16BE(startAddress, 0)
  data.writeUInt16BE(regCount, 2)
  return data
}

function handleWriteMultipleRegs(rxData: Buffer): Buffer {
  const { startAddress, regCount } = readStartAddressAndRegCount(rxData)
  const regs = {}
  rxData.copy(numericRegs, startAddress * 2, 4)
  console.log('wrote to holding regs (4x):', regs)
  return getWriteAckResponse({ startAddress, regCount })
}

function encodeResponse({
  functionCode,
  txId,
  data,
}: {
  functionCode: number
  txId: number
  data: Buffer
}): Buffer {
  const modbusTCPMessage = Buffer.alloc(data.length + MODBUS_TCP_HEADER_LEN)
  modbusTCPMessage.writeUInt16BE(txId, 0)
  modbusTCPMessage.writeUInt16BE(0, 2) // protocol id
  modbusTCPMessage.writeUInt16BE(data.length + MODBUS_LEN_EXTRA, 4)
  modbusTCPMessage.writeUInt8(0, 6)
  modbusTCPMessage.writeUInt8(functionCode, 7)
  data.copy(modbusTCPMessage, MODBUS_TCP_HEADER_LEN)
  return modbusTCPMessage
}

function handleModbusMessage({
  rxBuf,
  socket,
}: {
  rxBuf: Buffer
  socket: Socket
}): void {
  if (rxBuf.length < 8)
    throw Error(`modbus TCP message should be at least 8 bytes`)
  const txId = rxBuf.readUInt16BE(0)
  const protocolId = rxBuf.readUInt16BE(2)
  // const unitId = rxBuf.readUInt8(6)
  const functionCode = rxBuf.readUInt8(7)

  if (protocolId !== 0) throw Error(`unexpected protocol id: ${protocolId}`)

  const rxData = rxBuf.slice(8)
  let response: Buffer | undefined

  switch (functionCode) {
    case MODBUS_FN_CODE_READ_DISCRETE_OUTPUTS:
      break
    case MODBUS_FN_CODE_READ_DISCRETE_INPUTS:
      break
    case MODBUS_FN_CODE_READ_OUTPUT_REGS:
    case MODBUS_FN_CODE_READ_INPUT_REGS:
      response = handleReadMultipleRegs(rxData)
      break
    case MODBUS_FN_CODE_WRITE_SINGLE_COIL:
      break
    case MODBUS_FN_CODE_WRITE_SINGLE_REG:
      break
    case MODBUS_FN_CODE_WRITE_MULTIPLE_DISCRETE:
      break
    case MODBUS_FN_CODE_WRITE_MULTIPLE_REGS:
      response = handleWriteMultipleRegs(rxData)
      break
    default:
      throw Error(`unexpected modbus function code: ${functionCode}`)
  }

  if (response)
    socket.write(encodeResponse({ functionCode, txId, data: response }))
}

class ModbusConnection {
  private readonly sock: Socket
  private readonly connectionIdx: number

  buf: Buffer = Buffer.alloc(256)
  pos = 0
  len = 0
  destroyed = false

  constructor(sock: Socket, connectionIdx: number) {
    this.sock = sock
    this.connectionIdx = connectionIdx
    sock.on('data', this.onData)
    sock.on('end', () => {
      if (this.destroyed) return
      console.log(`connection ${this.connectionIdx} closed`)
      this.destroyed = true
    })
  }

  private onData = (rxData: Buffer): void => {
    if (this.destroyed) return
    let rxPos = 0
    while (rxPos < rxData.length) {
      const rxRemain = rxData.length - rxPos
      const headerRemain = MODBUS_TCP_HEADER_LEN - this.pos
      if (headerRemain > 0) {
        const copyCount = Math.min(headerRemain, rxRemain)
        rxData.copy(this.buf, this.pos, rxPos, rxPos + copyCount)
        rxPos += copyCount
        this.pos += copyCount
        if (this.pos >= MODBUS_TCP_HEADER_LEN) {
          this.len =
            this.buf.readUInt16BE(4) + MODBUS_TCP_HEADER_LEN - MODBUS_LEN_EXTRA
          // resize buffer if needed
          if (this.buf.length < this.len) {
            const newBuf = Buffer.alloc(this.len)
            this.buf.copy(newBuf)
            this.buf = newBuf
          }
        }
      } else {
        let packetRemain = this.len - this.pos
        if (packetRemain > 0) {
          const copyCount = Math.min(packetRemain, rxRemain)
          rxData.copy(this.buf, this.pos, rxPos, rxPos + copyCount)
          packetRemain -= copyCount
          rxPos += copyCount
          this.pos += copyCount
        }
        if (packetRemain <= 0) {
          // process packet
          try {
            handleModbusMessage({
              rxBuf: this.buf.slice(0, this.len),
              socket: this.sock,
            })
            this.pos = 0
            this.len = 0
          } catch (err) {
            console.log(
              `closing connection ${this.connectionIdx} due to error:`,
              err
            )
            this.destroyed = true
            this.sock.destroy()
          }
        }
      }
    }
  }
}

let curClientSerial = 0

const server = createServer((socket: Socket) => {
  const clientSerial = ++curClientSerial
  console.log(`client ${clientSerial} connected`)
  new ModbusConnection(socket, curClientSerial)
})

server.on('error', (err: Error) => {
  console.error('server error:', err)
  process.exit(1)
})

const port = parseInt(process.env.PORT || '') || 502
server.listen(port)
console.log(`listening for modbus connections on port ${port}`)
