import { decodeBoolean, encodeBoolean } from './booleanCodec'
import {
  MODBUS_LEN_EXTRA,
  MODBUS_TCP_HEADER_LEN,
  WritePacketCallback,
} from './ModbusCommon'

enum ModbusFunction {
  READ_COILS = 1,
  READ_DISCRETE_INPUTS = 2,
  READ_OUTPUT_REGS = 3,
  READ_INPUT_REGS = 4,
  WRITE_SINGLE_COIL = 5,
  WRITE_SINGLE_REG = 6,
  WRITE_MULTIPLE_COILS = 15,
  WRITE_MULTIPLE_REGS = 16,
}

const MODBUS_ERROR_FLAG = 0x80

enum ModbusErrorCode {
  BAD_FUNCTION_CODE = 1,
  BAD_ADDRESS = 2,
  BAD_REGISTER_COUNT = 3,
  INTERNAL_ERROR = 4,
}

const MODBUS_ADDRESSES_PER_OP = 0x10000

const MAX_COILS_PER_READ_REQUEST = 2000 // 0x7D0
const MAX_COILS_PER_WRITE_REQUEST = 1968 // 0x7B0

const MAX_REGS_PER_READ_REQUEST = 125 // 0x7D
const MAX_REGS_PER_WRITE_REQUEST = 123 // 0x7B

const ADDRESS_AND_REG_COUNT_OVERHEAD = 4
// Add 1 extra byte here because numBytes, which is redundant, is the 5th
// byte, located after the address and register count
const ADDRESS_AND_REG_COUNT_OVERHEAD_FOR_WRITE =
  ADDRESS_AND_REG_COUNT_OVERHEAD + 1

const WRITE_SINGLE_ITEM_PAYLOAD_LEN = 4

class ModbusError extends Error {
  readonly modbusErrorCode: ModbusErrorCode
  constructor(modbusErrorCode: ModbusErrorCode, message: string) {
    super(message)
    this.modbusErrorCode = modbusErrorCode
  }
}

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

function validateAddressAndCount(
  address: number,
  regCount: number,
  max: number
): void {
  if (!regCount)
    throw new ModbusError(
      ModbusErrorCode.BAD_REGISTER_COUNT,
      'register count cannot be 0'
    )
  if (regCount > max)
    throw new ModbusError(
      ModbusErrorCode.BAD_REGISTER_COUNT,
      `register count is ${regCount}, cannot be greater than ${max}`
    )
  if (address + regCount >= MODBUS_ADDRESSES_PER_OP)
    throw new ModbusError(
      ModbusErrorCode.BAD_ADDRESS,
      `register address overrun: start ${address} + count ${regCount} > ${MODBUS_ADDRESSES_PER_OP}`
    )
}

export default class ModbusServer {
  readonly numericRegs: Buffer = Buffer.alloc(MODBUS_ADDRESSES_PER_OP * 2) // 16 bits per reg
  readonly coils: boolean[] = []
  maxRegAddress = 0

  private handleReadCoils(rxData: Buffer): Buffer {
    const { startAddress, regCount } = readStartAddressAndRegCount(rxData)
    validateAddressAndCount(startAddress, regCount, MAX_COILS_PER_READ_REQUEST)

    const dataBytes = Math.ceil(regCount / 8)
    const response = Buffer.alloc(dataBytes + 1)
    response[0] = dataBytes
    encodeBoolean(response, 1, this.coils, startAddress, regCount)
    return response
  }

  private handleReadMultipleRegs(rxData: Buffer): Buffer {
    const { startAddress, regCount } = readStartAddressAndRegCount(rxData)
    validateAddressAndCount(startAddress, regCount, MAX_REGS_PER_READ_REQUEST)

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

  private handleWriteSingleCoil(rxData: Buffer): Buffer {
    if (WRITE_SINGLE_ITEM_PAYLOAD_LEN !== rxData.length)
      throw new ModbusError(
        ModbusErrorCode.BAD_REGISTER_COUNT,
        `unexpected length of write single coil request payload: expected ${WRITE_SINGLE_ITEM_PAYLOAD_LEN}, got ${rxData.length}`
      )
    const address = rxData.readUInt16BE(0)
    const intValue = rxData.readUInt16BE(2)
    let boolValue
    switch (intValue) {
      case 0:
        boolValue = false
        break
      case 0xff00:
        boolValue = true
        break
      default:
        throw new ModbusError(
          ModbusErrorCode.BAD_REGISTER_COUNT,
          `single coil value must be 0 or 0xFF00, was 0x${intValue.toString(
            16
          )}`
        )
    }
    this.coils[address] = boolValue
    // for a write single coil request, we can just echo back the request payload
    return rxData
  }

  private handleWriteSingleReg(rxData: Buffer): Buffer {
    if (WRITE_SINGLE_ITEM_PAYLOAD_LEN !== rxData.length)
      throw new ModbusError(
        ModbusErrorCode.BAD_REGISTER_COUNT,
        `unexpected length of write single register request payload: expected ${WRITE_SINGLE_ITEM_PAYLOAD_LEN}, got ${rxData.length}`
      )
    const address = rxData.readUInt16BE(0)
    const value = rxData.readUInt16BE(2)
    this.numericRegs.writeUInt16BE(value, address * 2)
    // for a write single reg request, we can just echo back the request payload
    this.maxRegAddress = Math.max(this.maxRegAddress, address)
    return rxData
  }

  private handleWriteMultipleCoils(rxData: Buffer): Buffer {
    const { startAddress, regCount } = readStartAddressAndRegCount(rxData)
    validateAddressAndCount(startAddress, regCount, MAX_COILS_PER_WRITE_REQUEST)
    const numBytes = Math.ceil(regCount / 8)
    const expectedLength = numBytes + ADDRESS_AND_REG_COUNT_OVERHEAD_FOR_WRITE
    if (expectedLength !== rxData.length)
      throw new ModbusError(
        ModbusErrorCode.BAD_REGISTER_COUNT,
        `unexpected length of write request for ${regCount} coils: expected ${expectedLength} bytes, got ${rxData.length}`
      )
    const actualNumBytes = rxData.readUInt8(4)
    if (actualNumBytes !== numBytes)
      throw new ModbusError(
        ModbusErrorCode.BAD_REGISTER_COUNT,
        `unexpected numBytes: got ${actualNumBytes}, expected ${numBytes}`
      )
    decodeBoolean(
      this.coils,
      startAddress,
      rxData,
      ADDRESS_AND_REG_COUNT_OVERHEAD_FOR_WRITE,
      regCount
    )
    return getWriteAckResponse({ startAddress, regCount })
  }

  private handleWriteMultipleRegs(rxData: Buffer): Buffer {
    const { startAddress, regCount } = readStartAddressAndRegCount(rxData)
    validateAddressAndCount(startAddress, regCount, MAX_REGS_PER_WRITE_REQUEST)
    const expectedLength =
      regCount * 2 + ADDRESS_AND_REG_COUNT_OVERHEAD_FOR_WRITE
    if (expectedLength !== rxData.length)
      throw new ModbusError(
        ModbusErrorCode.INTERNAL_ERROR,
        `unexpected length of write request for ${regCount} regs: expected ${expectedLength} bytes, got ${rxData.length}`
      )
    rxData.copy(
      this.numericRegs,
      startAddress * 2,
      ADDRESS_AND_REG_COUNT_OVERHEAD_FOR_WRITE
    )
    this.maxRegAddress = Math.max(this.maxRegAddress, startAddress + regCount)
    return getWriteAckResponse({ startAddress, regCount })
  }

  handleModbusMessage({
    rxBuf,
    writePacketCallback,
  }: {
    rxBuf: Buffer
    writePacketCallback: WritePacketCallback
  }): void {
    let response: Buffer | undefined
    let txId, unitId, functionCode, responseFunctionCode
    try {
      if (rxBuf.length < 8)
        throw Error(`modbus TCP message should be at least 8 bytes`)
      txId = rxBuf.readUInt16BE(0)
      const protocolId = rxBuf.readUInt16BE(2)
      unitId = rxBuf.readUInt8(6)
      functionCode = rxBuf.readUInt8(7)

      if (protocolId !== 0)
        throw new ModbusError(
          ModbusErrorCode.INTERNAL_ERROR,
          `unexpected protocol id: ${protocolId}`
        )

      const rxData = rxBuf.slice(8)

      switch (functionCode) {
        case ModbusFunction.READ_COILS:
        case ModbusFunction.READ_DISCRETE_INPUTS:
          response = this.handleReadCoils(rxData)
          break
        case ModbusFunction.READ_OUTPUT_REGS:
        case ModbusFunction.READ_INPUT_REGS:
          response = this.handleReadMultipleRegs(rxData)
          break
        case ModbusFunction.WRITE_SINGLE_COIL:
          response = this.handleWriteSingleCoil(rxData)
          break
        case ModbusFunction.WRITE_SINGLE_REG:
          response = this.handleWriteSingleReg(rxData)
          break
        case ModbusFunction.WRITE_MULTIPLE_COILS:
          response = this.handleWriteMultipleCoils(rxData)
          break
        case ModbusFunction.WRITE_MULTIPLE_REGS:
          response = this.handleWriteMultipleRegs(rxData)
          break
        default:
          throw new ModbusError(
            ModbusErrorCode.BAD_FUNCTION_CODE,
            `unsupported modbus function code: ${functionCode}`
          )
      }
      responseFunctionCode = functionCode
    } catch (err) {
      console.error('error handling request:', err)
      responseFunctionCode = MODBUS_ERROR_FLAG | (functionCode || 0)
      const modbusErrorCode =
        (err as ModbusError).modbusErrorCode || ModbusErrorCode.INTERNAL_ERROR
      response = Buffer.alloc(1)
      response.writeUInt8(modbusErrorCode)
    }

    if (unitId != null && responseFunctionCode && txId != null && response) {
      const responseEncoded = encodeResponse({
        unitId,
        functionCode: responseFunctionCode,
        txId,
        data: response,
      })
      writePacketCallback(responseEncoded)
    }
  }
}
