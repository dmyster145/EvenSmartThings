/**
 * Debug log to the phone's web UI (glasses-active panel).
 * Messages appear in the #debug-log pre element.
 */

const DEBUG_LOG_ID = 'debug-log';
const MAX_LINES = 80;
const MAX_DATA_LEN = 200;

function getEl(): HTMLPreElement | null {
  if (typeof document === 'undefined') return null;
  return document.getElementById(DEBUG_LOG_ID) as HTMLPreElement | null;
}

function safeStringify(data: unknown): string {
  try {
    const s = typeof data === 'object' && data !== null ? JSON.stringify(data) : String(data);
    return s.length > MAX_DATA_LEN ? s.slice(0, MAX_DATA_LEN) + '…' : s;
  } catch {
    return '[?]';
  }
}

export function debugLog(message: string, data?: unknown): void {
  const el = getEl();
  if (!el) return;
  const ts = new Date().toISOString().slice(11, 23);
  const dataStr = data !== undefined ? ' ' + safeStringify(data) : '';
  const line = `[${ts}] ${message}${dataStr}\n`;
  el.textContent = (el.textContent || '') + line;
  const lines = el.textContent.split('\n');
  if (lines.length > MAX_LINES) {
    el.textContent = lines.slice(-MAX_LINES).join('\n') + (el.textContent.endsWith('\n') ? '\n' : '');
  }
  el.scrollTop = el.scrollHeight;
}

export function debugClear(): void {
  const el = getEl();
  if (el) el.textContent = '';
}
