export const MODBUS_LEN_EXTRA = 2
export const MODBUS_TCP_HEADER_LEN = 8

export type WritePacketCallback = (buf: Buffer) => void
