import ModbusServer from './ModbusServer'

import {
  MODBUS_LEN_EXTRA,
  MODBUS_TCP_HEADER_LEN,
  WritePacketCallback,
} from './ModbusCommon'

export default class ModbusConnection {
  private readonly modbusServer: ModbusServer
  private readonly writePacketCallback: WritePacketCallback

  private buf: Buffer = Buffer.alloc(256)
  private pos = 0
  private len = 0

  constructor({
    modbusServer,
    writePacketCallback,
  }: {
    modbusServer: ModbusServer
    writePacketCallback: WritePacketCallback
  }) {
    this.modbusServer = modbusServer
    this.writePacketCallback = writePacketCallback
  }

  onData(rxData: Buffer): void {
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
          this.modbusServer.handleModbusMessage({
            rxBuf: this.buf.slice(0, this.len),
            writePacketCallback: this.writePacketCallback,
          })
          this.pos = 0
          this.len = 0
        }
      }
    }
  }
}
