import { existsSync } from 'fs'
import { mkdir, readFile, writeFile } from 'fs/promises'
import path from 'path'

const MIN_WAIT = 1000 * 5

const FILE_HEADER_LEN = 8

const FILE_PREAMBLE = 856

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
      if (fileLen < FILE_HEADER_LEN)
        throw Error(`file is too short to fit header: ${fileLen} bytes`)
      const preamble = fileData.readUInt32LE(0)
      if (FILE_PREAMBLE !== preamble)
        throw Error(
          `unexpected preamble: expected ${FILE_PREAMBLE}, was ${preamble}`
        )
      const numRegs = fileData.readUInt32LE(4)
      const dataEnd = FILE_HEADER_LEN + numRegs * 2
      if (fileLen < dataEnd)
        throw Error(
          `file is truncated: expected ${dataEnd} bytes for ${numRegs} regs, got ${fileLen}`
        )
      const { modbusServer } = this
      const { numericRegs, maxNumericRegAddress } = modbusServer
      fileData.copy(numericRegs, 0, FILE_HEADER_LEN, dataEnd)
      modbusServer.maxNumericRegAddress = Math.max(
        maxNumericRegAddress,
        numRegs
      )
      console.log(
        `loaded modbus server state (${numRegs} registers) from ${FILE_PATH}`
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
      const { numericRegs, maxNumericRegAddress } = this.modbusServer
      const dataLen = maxNumericRegAddress * 2
      const fileToSave = Buffer.alloc(FILE_HEADER_LEN + dataLen)
      fileToSave.writeUInt32LE(FILE_PREAMBLE, 0)
      fileToSave.writeUInt32LE(maxNumericRegAddress, 4)
      numericRegs.copy(fileToSave, FILE_HEADER_LEN, 0, dataLen)
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
