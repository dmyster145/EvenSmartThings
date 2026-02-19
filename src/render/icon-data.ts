/**
 * Icon image data for glasses display.
 * Loads PNGs from /icons/ when present (ThumbsUp, ThumbsDown, ThisClose), else uses programmatic placeholders.
 * Single status area: thumbs at CONFIRMATION_WIDTH×HEIGHT (top center).
 */

import { CONFIRMATION_WIDTH, CONFIRMATION_HEIGHT } from '../state/constants';

/** Result for confirmation icon: all success, some success (partial), or all failed. */
export type ConfirmationResult = 'success' | 'partial' | 'failure';

const ICON_BASE = '/icons';
const THUMB_UP_URL = `${ICON_BASE}/ThumbsUp.png`;
const THUMB_DOWN_URL = `${ICON_BASE}/ThumbsDown.png`;
const THUMB_PARTIAL_URL = `${ICON_BASE}/ThisClose.png`;

type CachedIcon = { png: string; raw: number[] };

const iconCache: {
  thumbUp: CachedIcon | null;
  thumbDown: CachedIcon | null;
  thumbPartial: CachedIcon | null;
} = { thumbUp: null, thumbDown: null, thumbPartial: null };

/** Load image from URL, scale to target size, return PNG base64 and raw grayscale number[]. */
function loadPngAndRaw(
  url: string,
  targetWidth: number,
  targetHeight: number
): Promise<{ png: string; raw: number[] } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
      const dataUrl = canvas.toDataURL('image/png');
      const png = dataUrl.includes(',') ? dataUrl.split(',')[1]! : dataUrl;
      const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
      const raw: number[] = [];
      for (let i = 0; i < imageData.data.length; i += 4) {
        const r = imageData.data[i]!;
        const g = imageData.data[i + 1]!;
        const b = imageData.data[i + 2]!;
        raw.push(Math.floor(0.299 * r + 0.587 * g + 0.114 * b));
      }
      resolve({ png, raw });
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** Preload /icons/*.png into cache (PNG + raw for device). */
export async function loadIconCache(): Promise<void> {
  const [thumbUp, thumbDown, thumbPartial] = await Promise.all([
    loadPngAndRaw(THUMB_UP_URL, CONFIRMATION_WIDTH, CONFIRMATION_HEIGHT),
    loadPngAndRaw(THUMB_DOWN_URL, CONFIRMATION_WIDTH, CONFIRMATION_HEIGHT),
    loadPngAndRaw(THUMB_PARTIAL_URL, CONFIRMATION_WIDTH, CONFIRMATION_HEIGHT),
  ]);
  iconCache.thumbUp = thumbUp;
  iconCache.thumbDown = thumbDown;
  iconCache.thumbPartial = thumbPartial;
}

/** 1-bit BMP file constants (same structure as Even Chess for G2 compatibility). */
const BMP_FILE_HEADER_SIZE = 14;
const BMP_DIB_HEADER_SIZE = 40;
const BMP_COLOR_TABLE_SIZE = 8;
const BMP_HEADER_SIZE = BMP_FILE_HEADER_SIZE + BMP_DIB_HEADER_SIZE + BMP_COLOR_TABLE_SIZE; // 62

function getBmpRowStride(width: number): number {
  const rowBytes = Math.ceil(width / 8);
  return Math.ceil(rowBytes / 4) * 4;
}

const BMP_PPM = 2835;

/** Convert grayscale number[] (0–255) to 1-bit BMP file as number[] for real glasses (Even Chess uses BMP). */
function grayToBmp(data: number[], width: number, height: number): number[] {
  const rowStride = getBmpRowStride(width);
  const pixelDataSize = rowStride * height;
  const fileSize = BMP_HEADER_SIZE + pixelDataSize;
  const out = new Array<number>(fileSize);
  let i = 0;
  out[i++] = 0x42; out[i++] = 0x4d;
  out[i++] = fileSize & 0xff; out[i++] = (fileSize >> 8) & 0xff; out[i++] = (fileSize >> 16) & 0xff; out[i++] = (fileSize >> 24) & 0xff;
  out[i++] = 0; out[i++] = 0; out[i++] = 0; out[i++] = 0;
  out[i++] = BMP_HEADER_SIZE; out[i++] = 0; out[i++] = 0; out[i++] = 0;
  out[i++] = 40; out[i++] = 0; out[i++] = 0; out[i++] = 0;
  out[i++] = width & 0xff; out[i++] = (width >> 8) & 0xff; out[i++] = (width >> 16) & 0xff; out[i++] = (width >> 24) & 0xff;
  out[i++] = height & 0xff; out[i++] = (height >> 8) & 0xff; out[i++] = (height >> 16) & 0xff; out[i++] = (height >> 24) & 0xff;
  out[i++] = 1; out[i++] = 0; out[i++] = 1; out[i++] = 0;
  out[i++] = 0; out[i++] = 0; out[i++] = 0; out[i++] = 0;
  out[i++] = pixelDataSize & 0xff; out[i++] = (pixelDataSize >> 8) & 0xff; out[i++] = (pixelDataSize >> 16) & 0xff; out[i++] = (pixelDataSize >> 24) & 0xff;
  out[i++] = BMP_PPM & 0xff; out[i++] = (BMP_PPM >> 8) & 0xff; out[i++] = (BMP_PPM >> 16) & 0xff; out[i++] = (BMP_PPM >> 24) & 0xff;
  out[i++] = BMP_PPM & 0xff; out[i++] = (BMP_PPM >> 8) & 0xff; out[i++] = (BMP_PPM >> 16) & 0xff; out[i++] = (BMP_PPM >> 24) & 0xff;
  out[i++] = 2; out[i++] = 0; out[i++] = 0; out[i++] = 0;
  out[i++] = 2; out[i++] = 0; out[i++] = 0; out[i++] = 0;
  out[i++] = 0; out[i++] = 0; out[i++] = 0; out[i++] = 0;
  out[i++] = 0xff; out[i++] = 0xff; out[i++] = 0xff; out[i++] = 0;
  for (let y = height - 1; y >= 0; y--) {
    for (let col = 0; col < rowStride; col++) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit++) {
        const x = col * 8 + (7 - bit);
        if (x < width) {
          const g = data[y * width + x] ?? 0;
          if (g >= 128) byte |= 1 << bit;
        }
      }
      out[i++] = byte;
    }
  }
  return out;
}

/** Convert grayscale number[] (0–255) to PNG base64 string for SDK. */
function grayToPngBase64(data: number[], width: number, height: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const imageData = ctx.createImageData(width, height);
  for (let i = 0; i < data.length; i++) {
    const g = Math.max(0, Math.min(255, data[i] ?? 0));
    imageData.data[i * 4] = g;
    imageData.data[i * 4 + 1] = g;
    imageData.data[i * 4 + 2] = g;
    imageData.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
  const dataUrl = canvas.toDataURL('image/png');
  return dataUrl.includes(',') ? dataUrl.split(',')[1]! : dataUrl;
}

const WHITE = 255;
const BLACK = 0;

/** Fill a rect in a width×height buffer (row-major). */
function fillRect(
  data: number[],
  width: number,
  height: number,
  x: number,
  y: number,
  w: number,
  h: number,
  value: number
): void {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const px = x + dx;
      const py = y + dy;
      if (px >= 0 && px < width && py >= 0 && py < height) {
        data[py * width + px] = value;
      }
    }
  }
}

function buildConfirmationPlaceholder(result: ConfirmationResult): number[] {
  const w = CONFIRMATION_WIDTH;
  const h = CONFIRMATION_HEIGHT;
  const data = new Array<number>(w * h).fill(BLACK);
  const cx = Math.floor(w / 2);
  const cy = Math.floor(h / 2);
  const scale = Math.min(w / 56, h / 34);
  const pad = (n: number) => Math.round(n * scale);
  if (result === 'success') {
    for (let i = 0; i < 12; i++) {
      fillRect(data, w, h, cx - pad(8) + i, cy - pad(18) + i, Math.max(1, pad(16) - pad(i * 2)), 1, WHITE);
    }
    fillRect(data, w, h, cx - pad(4), cy - pad(6), pad(8), pad(14), WHITE);
  } else if (result === 'failure') {
    for (let i = 0; i < 12; i++) {
      fillRect(data, w, h, cx - pad(10) + i, cy - pad(12) + i, Math.max(1, pad(i * 2)), 1, WHITE);
    }
    fillRect(data, w, h, cx - pad(4), cy, pad(8), pad(14), WHITE);
  } else {
    // partial: "this close" — two short vertical bars close together (finger & thumb)
    const gap = Math.max(1, pad(4));
    fillRect(data, w, h, cx - gap - pad(3), cy - pad(10), pad(2), pad(12), WHITE);
    fillRect(data, w, h, cx + gap, cy - pad(10), pad(2), pad(12), WHITE);
  }
  return data;
}

function getCachedIconForResult(result: ConfirmationResult): CachedIcon | null {
  switch (result) {
    case 'success':
      return iconCache.thumbUp;
    case 'failure':
      return iconCache.thumbDown;
    case 'partial':
      return iconCache.thumbPartial;
  }
}

/** Confirmation icon as PNG base64 (for simulator). */
export function getConfirmationImageData(result: ConfirmationResult): string {
  const cached = getCachedIconForResult(result);
  if (cached) return cached.png;
  return grayToPngBase64(buildConfirmationPlaceholder(result), CONFIRMATION_WIDTH, CONFIRMATION_HEIGHT);
}

/** Confirmation icon as 1-bit BMP number[] (for real glasses; Even Chess uses BMP). */
export function getConfirmationImageDataRaw(result: ConfirmationResult): number[] {
  const cached = getCachedIconForResult(result);
  const data = cached ? cached.raw : buildConfirmationPlaceholder(result);
  return grayToBmp(data, CONFIRMATION_WIDTH, CONFIRMATION_HEIGHT);
}

/** Blank (all black) image for hiding icons; blends with dark display background. useRaw: BMP for glasses, PNG base64 for simulator. */
export function getBlankImageData(width: number, height: number, useRaw: boolean): string | number[] {
  const data = new Array<number>(width * height).fill(0);
  return useRaw ? grayToBmp(data, width, height) : grayToPngBase64(data, width, height);
}

/** Optional: load PNG from URL and return grayscale number[] for given width×height. */
export function loadImageAsRawData(
  url: string,
  targetWidth: number,
  targetHeight: number
): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('No 2d context'));
        return;
      }
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
      const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
      const out: number[] = [];
      for (let i = 0; i < imageData.data.length; i += 4) {
        const r = imageData.data[i]!;
        const g = imageData.data[i + 1]!;
        const b = imageData.data[i + 2]!;
        out.push(Math.floor(0.299 * r + 0.587 * g + 0.114 * b));
      }
      resolve(out);
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = url;
  });
}
