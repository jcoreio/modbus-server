import { existsSync } from 'fs'
import { mkdir, readFile, writeFile } from 'fs/promises'
import path from 'path'

import { decodeBoolean, encodeBoolean } from './booleanCodec'

const MIN_WAIT = 1000 * 5

const FILE_HEADER_LEN = 8
const COILS_HEADER_LEN = 8

const FILE_PREAMBLE = 856
const COILS_PREAMBLE = 9413

const DATA_DIR = path.resolve(__dirname, '..', 'data')
const FILE_PATH = path.join(DATA_DIR, 'modbusServerState.bin')

import ModbusServer from './ModbusServer'

export default class PersistanceHandler {
  private readonly modbusServer: ModbusServer
  private readonly saveInterval: number

  private saveHandlerRunning = false
  private saveTimeout: NodeJS.Timeout | undefined
  private savePromise: Promise<void> | undefined
  private lastSaveBegin = 0

  private prevSavedFileData = Buffer.alloc(0)

  constructor(modbusServer: ModbusServer, saveInterval: number) {
    this.modbusServer = modbusServer
    this.saveInterval = saveInterval
  }

  async start(): Promise<void> {
    try {
      const fileData = await readFile(FILE_PATH)
      const fileLen = fileData.length

      const checkPreamble = (
        expected: number,
        pos: number,
        what: string
      ): void => {
        const actual = fileData.readUInt32LE(pos)
        if (expected !== actual)
          throw Error(
            `unexpected ${what} preamble: expected ${expected}, was ${actual}`
          )
      }

      const checkTruncation = (minLen: number, what: string): void => {
        if (fileLen < minLen)
          throw Error(
            `file is truncated: expected ${minLen} bytes for ${what}, got ${fileLen}`
          )
      }

      checkTruncation(FILE_HEADER_LEN, 'file header')
      checkPreamble(FILE_PREAMBLE, 0, 'file')

      const numRegs = fileData.readUInt32LE(4)
      const coilsHeaderBegin = FILE_HEADER_LEN + numRegs * 2
      const coilsBegin = coilsHeaderBegin + COILS_HEADER_LEN

      checkTruncation(coilsHeaderBegin, 'numeric register values')

      const { modbusServer } = this
      const { numericRegs, maxRegAddress, coils } = modbusServer
      fileData.copy(numericRegs, 0, FILE_HEADER_LEN, coilsHeaderBegin)
      modbusServer.maxRegAddress = Math.max(maxRegAddress, numRegs)

      let numCoilsDecoded = 0
      if (fileLen >= coilsBegin) {
        try {
          checkPreamble(COILS_PREAMBLE, coilsHeaderBegin, 'coils')
          const numCoils = fileData.readUInt32LE(coilsHeaderBegin + 4)
          const coilsLen = Math.ceil(numCoils / 8)
          checkTruncation(coilsBegin + coilsLen, 'coil values')
          decodeBoolean(coils, 0, fileData, coilsBegin, numCoils)
          numCoilsDecoded = numCoils
        } catch (err) {
          console.error(`could not load coils from ${FILE_PATH}`, err)
        }
      }

      console.log(
        `loaded modbus server state (${numRegs} registers, ${numCoilsDecoded} coils) from ${FILE_PATH}`
      )
    } catch (err) {
      if (existsSync(FILE_PATH)) {
        console.log(
          `error reading saved modbus server state from ${FILE_PATH}:`,
          err
        )
      } else if (!existsSync(DATA_DIR)) {
        console.log(`creating data directory: ${DATA_DIR}`)
        await mkdir(DATA_DIR)
      } else {
        console.log(`no modbus server state found at ${DATA_DIR}`)
      }
    }
    if (!this.saveHandlerRunning) {
      this.saveHandlerRunning = true
      this.scheduleSave()
    }
  }

  stop(): void {
    if (this.saveHandlerRunning) {
      this.saveHandlerRunning = false
      if (this.saveTimeout) {
        clearTimeout(this.saveTimeout)
        this.saveTimeout = undefined
      }
    }
  }

  private scheduleSave(): void {
    const { saveHandlerRunning, saveTimeout, lastSaveBegin } = this
    if (saveHandlerRunning && !saveTimeout) {
      const timeSinceLastSave = lastSaveBegin ? Date.now() - lastSaveBegin : 0
      this.saveTimeout = setTimeout(() => {
        this.save().catch((err: Error) => {
          console.log('uncaught error during save operation', err)
        })
      }, Math.max(this.saveInterval - timeSinceLastSave, MIN_WAIT))
    }
  }

  save(): Promise<void> {
    if (!this.savePromise) this.savePromise = this.doSave()
    return this.savePromise
  }

  private async doSave(): Promise<void> {
    this.saveTimeout = undefined
    this.lastSaveBegin = Date.now()
    let success = false
    try {
      const { numericRegs, coils, maxRegAddress } = this.modbusServer
      const numericRegsLen = maxRegAddress * 2
      const coilsHeaderPos = FILE_HEADER_LEN + numericRegsLen
      const coilsPos = coilsHeaderPos + COILS_HEADER_LEN
      const coilsLen = Math.ceil(coils.length / 8)
      const fileToSave = Buffer.alloc(coilsPos + coilsLen)

      fileToSave.writeUInt32LE(FILE_PREAMBLE, 0)
      fileToSave.writeUInt32LE(maxRegAddress, 4)
      numericRegs.copy(fileToSave, FILE_HEADER_LEN, 0, numericRegsLen)
      fileToSave.writeUInt32LE(COILS_PREAMBLE, coilsHeaderPos)
      fileToSave.writeUInt32LE(coils.length, coilsHeaderPos + 4)
      encodeBoolean(fileToSave, coilsPos, coils, 0, coils.length)

      if (!fileToSave.equals(this.prevSavedFileData)) {
        this.prevSavedFileData = fileToSave
        await writeFile(FILE_PATH, fileToSave)
      }
      success = true
    } catch (err) {
      this.saveHandlerRunning = false
      console.log('caught error while saving register states', err)
    } finally {
      this.savePromise = undefined
    }
    if (success) this.scheduleSave()
  }
}
