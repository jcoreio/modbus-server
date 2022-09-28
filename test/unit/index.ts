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
  READ_MULTIPLE_HOLDING_REGS = 3,
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

describe('modbus-server', () => {
  /* eslint-disable-next-line @typescript-eslint/no-empty-function */
  it('allows write and read-back', () => {
    const modbusServer = new ModbusServer()
    const responses: Buffer[] = []

    const requireResponse = (): ModbusResponse => {
      expect(responses.length).to.equal(1)
      const response = responses[0]
      responses.pop()
      return parseResponse(response)
    }

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

    const writeResponse: ModbusResponse = requireResponse()
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

    const readResponse = requireResponse()
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
})
