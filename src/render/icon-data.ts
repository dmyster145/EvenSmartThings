/**
 * Confirmation icon rendering for the glasses status container.
 * Loads /icons overrides when present (checkmark, exclamation, error),
 * then falls back to generated placeholder glyphs.
 */

import { CONFIRMATION_WIDTH, CONFIRMATION_HEIGHT } from '../state/constants';
import {
  BMP_SIGNATURE,
  BMP_DIB_HEADER_SIZE,
  BMP_HEADER_SIZE,
  BMP_PPM,
  BMP_COLORS_USED,
  getBmpRowStride,
  getBmpPixelDataSize,
  getBmpFileSize,
} from './bmp-constants';

/** Result for confirmation icon: all success, some success (partial), or all failed. */
export type ConfirmationResult = 'success' | 'partial' | 'failure';

const ICON_BASE = '/icons';
const CHECKMARK_URL = `${ICON_BASE}/checkmark.png`;
const EXCLAMATION_URL = `${ICON_BASE}/exclamation.png`;
const ERROR_URL = `${ICON_BASE}/error.png`;
/**
 * 1-bit conversion threshold.
 * Lower than 128 so anti-aliased icon edge pixels survive BMP quantization.
 */
const BMP_WHITE_THRESHOLD = 32;

type CachedIcon = { png: string; raw: number[] };

const iconCache: {
  checkmark: CachedIcon | null;
  exclamation: CachedIcon | null;
  error: CachedIcon | null;
} = { checkmark: null, exclamation: null, error: null };

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
      // If source already matches target, draw 1:1 to avoid any resampling artifacts.
      const sourceWidth = img.naturalWidth || img.width || targetWidth;
      const sourceHeight = img.naturalHeight || img.height || targetHeight;
      ctx.clearRect(0, 0, targetWidth, targetHeight);
      if (sourceWidth === targetWidth && sourceHeight === targetHeight) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, 0, 0);
      } else {
        // Fallback for non-60x60 assets: preserve aspect ratio and avoid upscaling.
        const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight, 1);
        const drawWidth = Math.max(1, Math.round(sourceWidth * scale));
        const drawHeight = Math.max(1, Math.round(sourceHeight * scale));
        const offsetX = Math.floor((targetWidth - drawWidth) / 2);
        const offsetY = Math.floor((targetHeight - drawHeight) / 2);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);
      }
      const dataUrl = canvas.toDataURL('image/png');
      const png = dataUrl.includes(',') ? dataUrl.split(',')[1]! : dataUrl;
      const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
      const raw: number[] = [];
      for (let i = 0; i < imageData.data.length; i += 4) {
        const r = imageData.data[i]!;
        const g = imageData.data[i + 1]!;
        const b = imageData.data[i + 2]!;
        const alphaByte = imageData.data[i + 3] ?? 255;
        const luma = 0.299 * r + 0.587 * g + 0.114 * b;
        // Favor alpha coverage so dark-colored but opaque icon pixels stay visible on 1-bit output.
        const monochromeValue = Math.floor((alphaByte * 3 + luma) / 4);
        raw.push(monochromeValue);
      }
      resolve({ png, raw });
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** Preload /icons/*.png into cache (PNG + raw for device). */
export async function loadIconCache(): Promise<void> {
  const [checkmark, exclamation, error] = await Promise.all([
    loadPngAndRaw(CHECKMARK_URL, CONFIRMATION_WIDTH, CONFIRMATION_HEIGHT),
    loadPngAndRaw(EXCLAMATION_URL, CONFIRMATION_WIDTH, CONFIRMATION_HEIGHT),
    loadPngAndRaw(ERROR_URL, CONFIRMATION_WIDTH, CONFIRMATION_HEIGHT),
  ]);
  iconCache.checkmark = checkmark;
  iconCache.exclamation = exclamation;
  iconCache.error = error;
}

/** Convert grayscale (0-255) pixels to 1-bit BMP bytes for real glasses. */
function grayToBmp(data: number[], width: number, height: number): number[] {
  const rowStride = getBmpRowStride(width);
  const pixelDataSize = getBmpPixelDataSize(width, height);
  const fileSize = getBmpFileSize(width, height);
  const out = new Array<number>(fileSize);
  let i = 0;
  out[i++] = BMP_SIGNATURE[0]; out[i++] = BMP_SIGNATURE[1];
  out[i++] = fileSize & 0xff; out[i++] = (fileSize >> 8) & 0xff; out[i++] = (fileSize >> 16) & 0xff; out[i++] = (fileSize >> 24) & 0xff;
  out[i++] = 0; out[i++] = 0; out[i++] = 0; out[i++] = 0;
  out[i++] = BMP_HEADER_SIZE; out[i++] = 0; out[i++] = 0; out[i++] = 0;
  out[i++] = BMP_DIB_HEADER_SIZE; out[i++] = 0; out[i++] = 0; out[i++] = 0;
  out[i++] = width & 0xff; out[i++] = (width >> 8) & 0xff; out[i++] = (width >> 16) & 0xff; out[i++] = (width >> 24) & 0xff;
  out[i++] = height & 0xff; out[i++] = (height >> 8) & 0xff; out[i++] = (height >> 16) & 0xff; out[i++] = (height >> 24) & 0xff;
  out[i++] = 1; out[i++] = 0; out[i++] = 1; out[i++] = 0;
  out[i++] = 0; out[i++] = 0; out[i++] = 0; out[i++] = 0;
  out[i++] = pixelDataSize & 0xff; out[i++] = (pixelDataSize >> 8) & 0xff; out[i++] = (pixelDataSize >> 16) & 0xff; out[i++] = (pixelDataSize >> 24) & 0xff;
  out[i++] = BMP_PPM & 0xff; out[i++] = (BMP_PPM >> 8) & 0xff; out[i++] = (BMP_PPM >> 16) & 0xff; out[i++] = (BMP_PPM >> 24) & 0xff;
  out[i++] = BMP_PPM & 0xff; out[i++] = (BMP_PPM >> 8) & 0xff; out[i++] = (BMP_PPM >> 16) & 0xff; out[i++] = (BMP_PPM >> 24) & 0xff;
  out[i++] = BMP_COLORS_USED; out[i++] = 0; out[i++] = 0; out[i++] = 0;
  out[i++] = BMP_COLORS_USED; out[i++] = 0; out[i++] = 0; out[i++] = 0;
  out[i++] = 0; out[i++] = 0; out[i++] = 0; out[i++] = 0;
  out[i++] = 0xff; out[i++] = 0xff; out[i++] = 0xff; out[i++] = 0;
  for (let y = height - 1; y >= 0; y--) {
    for (let col = 0; col < rowStride; col++) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit++) {
        const x = col * 8 + (7 - bit);
        if (x < width) {
          const g = data[y * width + x] ?? 0;
          if (g >= BMP_WHITE_THRESHOLD) byte |= 1 << bit;
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
    // partial fallback: two short vertical bars close together
    const gap = Math.max(1, pad(4));
    fillRect(data, w, h, cx - gap - pad(3), cy - pad(10), pad(2), pad(12), WHITE);
    fillRect(data, w, h, cx + gap, cy - pad(10), pad(2), pad(12), WHITE);
  }
  return data;
}

function getCachedIconForResult(result: ConfirmationResult): CachedIcon | null {
  switch (result) {
    case 'success':
      return iconCache.checkmark;
    case 'failure':
      return iconCache.error;
    case 'partial':
      return iconCache.exclamation;
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
