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

    const txnId = 44
    const unitId = 22
    conn.onData(
      frameRequest({
        txnId,
        unitId,
        functionCode: FunctionCode.WRITE_MULTIPLE_HOLDING_REGS,
        payload: testDataRequest,
      })
    )
    expect(responses.length).to.equal(1)
    const response: ModbusResponse = parseResponse(responses[0])
    expect(response.txnId).to.equal(txnId)
    expect(response.unitId).to.equal(unitId)
    expect(response.functionCode).to.equal(
      FunctionCode.WRITE_MULTIPLE_HOLDING_REGS
    )
    const { payload } = response
    expect(payload.length).to.equal(4)
    const addressOut = payload.readUInt16BE(0)
    expect(addressOut).to.equal(BEGIN_REG_ADDRESS)
    const numRegsOut = payload.readUInt16BE(2)
    expect(numRegsOut).to.equal(TEST_NUM_REGS)
  })
})
