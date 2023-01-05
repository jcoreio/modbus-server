/**
 * Encodes boolean values according to the Modbus protocol spec. Note that to follow
 * the protocol spec we must:
 * - Encode the lowest addresses in the lowest bytes
 * - Within each byte, encode the highest address in the MSBit and the lowest
 *   address in the LSBit
 * - If the number of addresses is not an even multiple of 8, put the remainder
 *   in the last byte, shifted toward the LSBits
 * @param dest destination buffer
 * @param destOffset offset in the destination buffer to begin writing
 * @param src source array
 * @param srcOffset offset in the source array to begin reading
 * @param count number of addresses to encode
 */
export function encodeBoolean(
  dest: Buffer,
  destOffset: number,
  src: boolean[],
  srcOffset: number,
  count: number
): void {
  let destIdx = destOffset // offset after writing the length
  let bitIdx = 0
  let byteValue = 0
  const srcEndIdx = srcOffset + count - 1 // inclusive
  for (let srcIdx = srcOffset; srcIdx <= srcEndIdx; ++srcIdx) {
    if (src[srcIdx]) byteValue |= 1 << bitIdx
    if (++bitIdx === 8 || srcIdx === srcEndIdx) {
      dest[destIdx++] = byteValue
      byteValue = 0
      bitIdx = 0
    }
  }
}

/**
 * Decodes boolean values according to the encoding specified above
 * @param dest destination boolean array for reading values
 * @param destOffset offset to begin writing
 * @param src source buffer for reading
 * @param srcOffset offset to begin reading
 * @param count number of addresses to decode
 */
export function decodeBoolean(
  dest: boolean[],
  destOffset: number,
  src: Buffer,
  srcOffset: number,
  count: number
): void {
  let bitIdx = 0
  let srcIdx = srcOffset
  const destEndIdx = destOffset + count // exclusive
  for (let destIdx = destOffset; destIdx < destEndIdx; ++destIdx) {
    dest[destIdx] = Boolean((src[srcIdx] >> bitIdx) & 1)
    if (++bitIdx === 8) {
      bitIdx = 0
      ++srcIdx
    }
  }
}
