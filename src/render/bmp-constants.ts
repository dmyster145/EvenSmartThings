/**
 * BMP format constants for 1-bit monochrome bitmap encoding.
 */

export const BMP_SIGNATURE = [0x42, 0x4d] as const;
export const BMP_FILE_HEADER_SIZE = 14;
export const BMP_DIB_HEADER_SIZE = 40;
export const BMP_COLOR_TABLE_SIZE = 8;
export const BMP_HEADER_SIZE = BMP_FILE_HEADER_SIZE + BMP_DIB_HEADER_SIZE + BMP_COLOR_TABLE_SIZE;
export const BMP_PPM = 2835;
export const BMP_COLORS_USED = 2;

export function getBmpRowBytes(width: number): number {
  return Math.ceil(width / 8);
}

export function getBmpRowStride(width: number): number {
  const rowBytes = getBmpRowBytes(width);
  return Math.ceil(rowBytes / 4) * 4;
}

export function getBmpPixelDataSize(width: number, height: number): number {
  return getBmpRowStride(width) * height;
}

export function getBmpFileSize(width: number, height: number): number {
  return BMP_HEADER_SIZE + getBmpPixelDataSize(width, height);
}
