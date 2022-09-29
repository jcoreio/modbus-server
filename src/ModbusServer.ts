import {
  MODBUS_LEN_EXTRA,
  MODBUS_TCP_HEADER_LEN,
  WritePacketCallback,
} from './ModbusCommon'

enum ModbusFunction {
  READ_DISCRETE_OUTPUTS = 1,
  READ_DISCRETE_INPUTS = 2,
  READ_OUTPUT_REGS = 3,
  READ_INPUT_REGS = 4,
  WRITE_SINGLE_DISCRETE = 5,
  WRITE_SINGLE_REG = 6,
  WRITE_MULTIPLE_DISCRETE = 15,
  WRITE_MULTIPLE_REGS = 16,
}

const MODBUS_ADDRESSES_PER_OP = 10000

const ADDRESS_AND_REG_COUNT_OVERHEAD = 4
// Add 1 extra byte here because numBytes, which is redundant, is the 5th
// byte, located after the address and register count
const ADDRESS_AND_REG_COUNT_OVERHEAD_FOR_WRITE =
  ADDRESS_AND_REG_COUNT_OVERHEAD + 1

const WRITE_SINGLE_REG_PAYLOAD_LEN = 4

function readStartAddressAndRegCount(
  buf: Buffer
): { startAddress: number; regCount: number } {
  if (buf.length < ADDRESS_AND_REG_COUNT_OVERHEAD)
    throw Error(
      `data buffer is too short to read address and register count: got ${buf.length}, must be at least ${ADDRESS_AND_REG_COUNT_OVERHEAD}`
    )
  return {
    startAddress: buf.readUInt16BE(0),
    regCount: buf.readUInt16BE(2),
  }
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

function encodeResponse({
  unitId,
  functionCode,
  txId,
  data,
}: {
  unitId: number
  functionCode: number
  txId: number
  data: Buffer
}): Buffer {
  const modbusTCPMessage = Buffer.alloc(data.length + MODBUS_TCP_HEADER_LEN)
  modbusTCPMessage.writeUInt16BE(txId, 0)
  modbusTCPMessage.writeUInt16BE(0, 2) // protocol id
  modbusTCPMessage.writeUInt16BE(data.length + MODBUS_LEN_EXTRA, 4)
  modbusTCPMessage.writeUInt8(unitId, 6)
  modbusTCPMessage.writeUInt8(functionCode, 7)
  data.copy(modbusTCPMessage, MODBUS_TCP_HEADER_LEN)
  return modbusTCPMessage
}

export default class ModbusServer {
  private readonly numericRegs: Buffer = Buffer.alloc(
    MODBUS_ADDRESSES_PER_OP * 2
  ) // 16 bits per reg
  private readonly coils: Buffer = Buffer.alloc(MODBUS_ADDRESSES_PER_OP / 8) // 8 coils per byte

  private handleReadMultipleRegs(rxData: Buffer): Buffer {
    const { startAddress, regCount } = readStartAddressAndRegCount(rxData)
    const response = Buffer.alloc(regCount * 2 + 1)
    response.writeUInt8(regCount * 2)
    this.numericRegs.copy(
      response,
      1,
      startAddress * 2,
      (startAddress + regCount) * 2
    )
    return response
  }

  private handleWriteSingleReg(rxData: Buffer): Buffer {
    if (WRITE_SINGLE_REG_PAYLOAD_LEN !== rxData.length)
      throw Error(
        `unexpected length of write single register request payload: expected ${WRITE_SINGLE_REG_PAYLOAD_LEN}, got ${rxData.length}`
      )
    const address = rxData.readUInt16BE(0)
    const value = rxData.readUInt16BE(2)
    this.numericRegs.writeUInt16BE(value, address * 2)
    // for a write single reg request, we can just echo back the request payload
    return rxData
  }

  private handleWriteMultipleRegs(rxData: Buffer): Buffer {
    const { startAddress, regCount } = readStartAddressAndRegCount(rxData)
    const expectedLength =
      regCount * 2 + ADDRESS_AND_REG_COUNT_OVERHEAD_FOR_WRITE
    if (expectedLength !== rxData.length)
      throw Error(
        `unexpected length of write request for ${regCount} regs: expected ${expectedLength} bytes, got ${rxData.length}`
      )
    rxData.copy(
      this.numericRegs,
      startAddress * 2,
      ADDRESS_AND_REG_COUNT_OVERHEAD_FOR_WRITE
    )
    return getWriteAckResponse({ startAddress, regCount })
  }

  handleModbusMessage({
    rxBuf,
    writePacketCallback,
  }: {
    rxBuf: Buffer
    writePacketCallback: WritePacketCallback
  }): void {
    if (rxBuf.length < 8)
      throw Error(`modbus TCP message should be at least 8 bytes`)
    const txId = rxBuf.readUInt16BE(0)
    const protocolId = rxBuf.readUInt16BE(2)
    const unitId = rxBuf.readUInt8(6)
    const functionCode = rxBuf.readUInt8(7)

    if (protocolId !== 0) throw Error(`unexpected protocol id: ${protocolId}`)

    const rxData = rxBuf.slice(8)
    let response: Buffer | undefined

    const unsupported = (functionCode: number): never => {
      throw Error(`unsupported modbus function code: ${functionCode}`)
    }

    switch (functionCode) {
      case ModbusFunction.READ_DISCRETE_OUTPUTS:
        unsupported(functionCode)
      case ModbusFunction.READ_DISCRETE_INPUTS:
        unsupported(functionCode)
      case ModbusFunction.READ_OUTPUT_REGS:
      case ModbusFunction.READ_INPUT_REGS:
        response = this.handleReadMultipleRegs(rxData)
        break
      case ModbusFunction.WRITE_SINGLE_DISCRETE:
        unsupported(functionCode)
      case ModbusFunction.WRITE_SINGLE_REG:
        response = this.handleWriteSingleReg(rxData)
        break
      case ModbusFunction.WRITE_MULTIPLE_DISCRETE:
        unsupported(functionCode)
      case ModbusFunction.WRITE_MULTIPLE_REGS:
        response = this.handleWriteMultipleRegs(rxData)
        break
      default:
        throw Error(`unexpected modbus function code: ${functionCode}`)
    }

    if (response)
      writePacketCallback(
        encodeResponse({ unitId, functionCode, txId, data: response })
      )
  }
}
