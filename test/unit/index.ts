import { describe, it } from 'mocha'
import { expect } from 'chai'

import ModbusServer from '../../src/ModbusServer'
import ModbusConnection from '../../src/ModbusConnection'

const TEST_NUM_REGS = 120
function getTestBuffer(): Buffer {
  const buf = Buffer.alloc(TEST_NUM_REGS * 2)
  for (let regIdx = 0; regIdx < TEST_NUM_REGS; ++regIdx) {
    buf.writeUInt16BE(regIdx * 2, regIdx * 2)
  }
  return buf
}

const MODBUS_FRAME_OVERHEAD = 8
const MODBUS_OVERHEAD_BEFORE_LENGTH = 6

enum FunctionCode {
  READ_COILS = 1,
  READ_DISCRETE_INPUTS = 2,
  READ_MULTIPLE_HOLDING_REGS = 3,
  READ_INPUT_REG = 4,
  WRITE_SINGLE_COIL = 5,
  WRITE_SINGLE_HOLDING_REG = 6,
  WRITE_MULTIPLE_COILS = 15,
  WRITE_MULTIPLE_HOLDING_REGS = 16,
}

function frameRequest({
  txnId,
  unitId,
  functionCode,
  payload,
}: {
  txnId?: number
  unitId?: number
  functionCode: number
  payload: Buffer
}): Buffer {
  const buf = Buffer.alloc(payload.length + MODBUS_FRAME_OVERHEAD)
  buf.writeUInt16BE(txnId || 0, 0)
  // bytes 2-3: protocol ID = 0
  buf.writeUInt16BE(payload.length + 2, 4)
  buf.writeUInt8(unitId || 0, 6)
  buf.writeUInt8(functionCode, 7)
  payload.copy(buf, 8)
  return buf
}

type ModbusResponse = {
  txnId: number
  length: number
  unitId: number
  functionCode: number
  payload: Buffer
}

function parseResponse(buf: Buffer): ModbusResponse {
  expect(buf.length).to.be.at.least(MODBUS_FRAME_OVERHEAD)
  const protocolId = buf.readUInt16BE(2)
  expect(protocolId).to.equal(0)
  const length = buf.readUInt16BE(4)
  expect(buf.length).to.equal(length + MODBUS_OVERHEAD_BEFORE_LENGTH)
  return {
    txnId: buf.readUInt16BE(0),
    length,
    unitId: buf.readUInt8(6),
    functionCode: buf.readUInt8(7),
    payload: buf.slice(8),
  }
}

function requireResponse(responses: Buffer[]): ModbusResponse {
  expect(responses.length).to.equal(1)
  const response = responses[0]
  responses.pop()
  return parseResponse(response)
}

describe('modbus-server', () => {
  it('writes and reads back multiple holding registers', () => {
    const modbusServer = new ModbusServer()
    const responses: Buffer[] = []

    const conn = new ModbusConnection({
      modbusServer,
      writePacketCallback: (response: Buffer): void => {
        responses.push(response)
      },
    })

    const testData = getTestBuffer()
    const testDataRequest = Buffer.alloc(testData.length + 5)

    const BEGIN_REG_ADDRESS = 80

    testDataRequest.writeUInt16BE(BEGIN_REG_ADDRESS, 0)
    testDataRequest.writeUInt16BE(TEST_NUM_REGS, 2)
    testDataRequest.writeUInt8(TEST_NUM_REGS * 2, 4)
    testData.copy(testDataRequest, 5)

    const writeTxnId = 44
    const unitId = 22
    conn.onData(
      frameRequest({
        txnId: writeTxnId,
        unitId,
        functionCode: FunctionCode.WRITE_MULTIPLE_HOLDING_REGS,
        payload: testDataRequest,
      })
    )

    const writeResponse: ModbusResponse = requireResponse(responses)
    expect(writeResponse.txnId).to.equal(writeTxnId)
    expect(writeResponse.unitId).to.equal(unitId)
    expect(writeResponse.functionCode).to.equal(
      FunctionCode.WRITE_MULTIPLE_HOLDING_REGS
    )
    const { payload: writeResponsePayload } = writeResponse
    expect(writeResponsePayload.length).to.equal(4)
    const addressOut = writeResponsePayload.readUInt16BE(0)
    expect(addressOut).to.equal(BEGIN_REG_ADDRESS)
    const numRegsOut = writeResponsePayload.readUInt16BE(2)
    expect(numRegsOut).to.equal(TEST_NUM_REGS)

    const readRequestPayload = Buffer.alloc(4)
    readRequestPayload.writeUInt16BE(BEGIN_REG_ADDRESS, 0)
    readRequestPayload.writeUInt16BE(TEST_NUM_REGS, 2)

    const readTxnId = writeTxnId + 1

    conn.onData(
      frameRequest({
        txnId: readTxnId,
        unitId,
        functionCode: FunctionCode.READ_MULTIPLE_HOLDING_REGS,
        payload: readRequestPayload,
      })
    )

    const readResponse = requireResponse(responses)
    expect(readResponse.txnId).to.equal(readTxnId)
    expect(readResponse.unitId).to.equal(unitId)
    expect(readResponse.functionCode).to.equal(
      FunctionCode.READ_MULTIPLE_HOLDING_REGS
    )
    const { payload: readResponsePayload } = readResponse
    // 2 bytes per reg + 1 byte for num bytes
    expect(readResponsePayload.length).to.equal(TEST_NUM_REGS * 2 + 1)
    const readResponseNumBytes = readResponsePayload.readUInt8(0)
    expect(readResponseNumBytes).to.equal(TEST_NUM_REGS * 2)
    expect(readResponsePayload.slice(1)).to.deep.equal(testData)
  })

  it('writes and reads back a single holding register', () => {
    const modbusServer = new ModbusServer()
    const responses: Buffer[] = []

    const conn = new ModbusConnection({
      modbusServer,
      writePacketCallback: (response: Buffer): void => {
        responses.push(response)
      },
    })

    const REG_ADDRESS = 9876
    const REG_VALUE = 432

    const writeRequest = Buffer.alloc(4)
    writeRequest.writeUInt16BE(REG_ADDRESS, 0)
    writeRequest.writeUInt16BE(REG_VALUE, 2)

    const writeTxnId = 78
    const unitId = 11
    conn.onData(
      frameRequest({
        txnId: writeTxnId,
        unitId,
        functionCode: FunctionCode.WRITE_SINGLE_HOLDING_REG,
        payload: writeRequest,
      })
    )

    const writeResponse: ModbusResponse = requireResponse(responses)
    expect(writeResponse.txnId).to.equal(writeTxnId)
    expect(writeResponse.unitId).to.equal(unitId)
    expect(writeResponse.functionCode).to.equal(
      FunctionCode.WRITE_SINGLE_HOLDING_REG
    )
    const { payload: writeResponsePayload } = writeResponse
    expect(writeResponsePayload).to.deep.equal(writeRequest)

    const readRequestPayload = Buffer.alloc(4)
    readRequestPayload.writeUInt16BE(REG_ADDRESS, 0)
    readRequestPayload.writeUInt16BE(1, 2) // read one register

    const readTxnId = writeTxnId + 1

    conn.onData(
      frameRequest({
        txnId: readTxnId,
        unitId,
        functionCode: FunctionCode.READ_MULTIPLE_HOLDING_REGS,
        payload: readRequestPayload,
      })
    )

    const readResponse = requireResponse(responses)
    expect(readResponse.txnId).to.equal(readTxnId)
    expect(readResponse.unitId).to.equal(unitId)
    expect(readResponse.functionCode).to.equal(
      FunctionCode.READ_MULTIPLE_HOLDING_REGS
    )
    const { payload: readResponsePayload } = readResponse
    // 2 bytes for register + 1 byte for num bytes
    expect(readResponsePayload.length).to.equal(3)
    const readResponseNumBytes = readResponsePayload.readUInt8(0)
    expect(readResponseNumBytes).to.equal(2)
    const readValue = readResponsePayload.readUInt16BE(1)
    expect(readValue).to.equal(REG_VALUE)
  })

  it('writes and reads back multiple coils', () => {
    const modbusServer = new ModbusServer()
    const responses: Buffer[] = []

    const conn = new ModbusConnection({
      modbusServer,
      writePacketCallback: (response: Buffer): void => {
        responses.push(response)
      },
    })

    const BEGIN_REG_ADDRESS = 80
    const TEST_NUM_COILS = 11

    const LOW_COILS = 0x72
    const HIGH_COILS = 0x5

    const testDataRequest = Buffer.alloc(7)
    testDataRequest.writeUInt16BE(BEGIN_REG_ADDRESS, 0)
    testDataRequest.writeUInt16BE(TEST_NUM_COILS, 2) // 11 regs
    testDataRequest.writeUInt8(2, 4) // 2 bytes
    testDataRequest.writeUInt8(LOW_COILS, 5)
    testDataRequest.writeUInt8(HIGH_COILS, 6)

    const writeTxnId = 44
    const unitId = 22
    conn.onData(
      frameRequest({
        txnId: writeTxnId,
        unitId,
        functionCode: FunctionCode.WRITE_MULTIPLE_COILS,
        payload: testDataRequest,
      })
    )

    const writeResponse: ModbusResponse = requireResponse(responses)
    expect(writeResponse.txnId).to.equal(writeTxnId)
    expect(writeResponse.unitId).to.equal(unitId)
    expect(writeResponse.functionCode).to.equal(
      FunctionCode.WRITE_MULTIPLE_COILS
    )
    const { payload: writeResponsePayload } = writeResponse
    expect(writeResponsePayload.length).to.equal(4)
    const addressOut = writeResponsePayload.readUInt16BE(0)
    expect(addressOut).to.equal(BEGIN_REG_ADDRESS)
    const numRegsOut = writeResponsePayload.readUInt16BE(2)
    expect(numRegsOut).to.equal(TEST_NUM_COILS)

    const readRequestPayload = Buffer.alloc(4)
    readRequestPayload.writeUInt16BE(BEGIN_REG_ADDRESS, 0)
    readRequestPayload.writeUInt16BE(TEST_NUM_COILS, 2) // read one coil

    const readTxnId = writeTxnId + 1

    conn.onData(
      frameRequest({
        txnId: readTxnId,
        unitId,
        functionCode: FunctionCode.READ_COILS,
        payload: readRequestPayload,
      })
    )

    const readResponse = requireResponse(responses)
    expect(readResponse.txnId).to.equal(readTxnId)
    expect(readResponse.unitId).to.equal(unitId)
    expect(readResponse.functionCode).to.equal(FunctionCode.READ_COILS)
    const { payload: readResponsePayload } = readResponse
    expect(readResponsePayload.length).to.equal(3)
    const readResponseNumBytes = readResponsePayload.readUInt8(0)
    expect(readResponseNumBytes).to.equal(2)
    expect(readResponsePayload.readUInt8(1)).to.equal(LOW_COILS)
    expect(readResponsePayload.readUInt8(2)).to.equal(HIGH_COILS)
  })

  for (const coilValue of [false, true]) {
    it(`writes and reads back an ${
      coilValue ? 'active' : 'inactive'
    } coil`, () => {
      const modbusServer = new ModbusServer()
      const responses: Buffer[] = []

      const conn = new ModbusConnection({
        modbusServer,
        writePacketCallback: (response: Buffer): void => {
          responses.push(response)
        },
      })

      const REG_ADDRESS = 9876

      const writeRequest = Buffer.alloc(4)
      writeRequest.writeUInt16BE(REG_ADDRESS, 0)
      writeRequest.writeUInt16BE(coilValue ? 0xff00 : 0, 2)

      const writeTxnId = 78
      const unitId = 11
      conn.onData(
        frameRequest({
          txnId: writeTxnId,
          unitId,
          functionCode: FunctionCode.WRITE_SINGLE_COIL,
          payload: writeRequest,
        })
      )

      const writeResponse: ModbusResponse = requireResponse(responses)
      expect(writeResponse.txnId).to.equal(writeTxnId)
      expect(writeResponse.unitId).to.equal(unitId)
      expect(writeResponse.functionCode).to.equal(
        FunctionCode.WRITE_SINGLE_COIL
      )
      const { payload: writeResponsePayload } = writeResponse
      expect(writeResponsePayload).to.deep.equal(writeRequest)

      const readRequestPayload = Buffer.alloc(4)
      readRequestPayload.writeUInt16BE(REG_ADDRESS, 0)
      readRequestPayload.writeUInt16BE(1, 2) // read one coil

      const readTxnId = writeTxnId + 1

      conn.onData(
        frameRequest({
          txnId: readTxnId,
          unitId,
          functionCode: FunctionCode.READ_COILS,
          payload: readRequestPayload,
        })
      )

      const readResponse = requireResponse(responses)
      expect(readResponse.txnId).to.equal(readTxnId)
      expect(readResponse.unitId).to.equal(unitId)
      expect(readResponse.functionCode).to.equal(FunctionCode.READ_COILS)
      const { payload: readResponsePayload } = readResponse
      expect(readResponsePayload.length).to.equal(2)
      const readResponseNumBytes = readResponsePayload.readUInt8(0)
      expect(readResponseNumBytes).to.equal(1)
      const readValue = readResponsePayload.readUInt8(1)
      expect(readValue).to.equal(coilValue ? 1 : 0)
    })
  }
})
