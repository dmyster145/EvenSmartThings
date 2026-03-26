/**
 * EvenHubBridge — SDK lifecycle and container operations.
 */

import {
  waitForEvenAppBridge,
  StartUpPageCreateResult,
  TextContainerUpgrade,
  type EvenAppBridge as EvenAppBridgeType,
  type CreateStartUpPageContainer,
  type RebuildPageContainer,
  type ImageRawDataUpdate,
  type EvenHubEvent,
  type DeviceInfo,
  type LaunchSource,
  ImageRawDataUpdateResult,
  DeviceModel,
} from '@evenrealities/even_hub_sdk';

export type EvenHubEventHandler = (event: EvenHubEvent) => void;
export type LaunchSourceHandler = (source: LaunchSource) => void;
export type SetupPageResult = {
  success: boolean;
  code: StartUpPageCreateResult | null;
};

// ── Tuning constants ──────────────────────────────────────────────────────────

/** How long to wait before retrying blocked text sends after the image link clears. */
const TEXT_GATE_RETRY_MS = 500;
/** Maximum image queue depth before the oldest entry is dropped. */
const IMAGE_QUEUE_MAX = 4;
/** Average send duration (ms) over the last N sends that triggers "link slow". */
const LINK_SLOW_THRESHOLD_MS = 800;
/** Rolling window size for link-health averaging. */
const LINK_SLOW_SAMPLE_SIZE = 3;

// ── Internal types ────────────────────────────────────────────────────────────

interface TextQueueEntry {
  key: string;
  containerID: number;
  containerName: string;
  content: string;
  enqueuedAtMs: number;
}

/** Cheap fingerprint for image dirty-checking — avoids storing full buffers.
 *  Samples first, middle, and last bytes. For 1-bit BMPs (same fixed header),
 *  first is always identical across images of the same size, so the mid byte
 *  (deep in the pixel data) is the primary discriminator between e.g. a blank
 *  image and a confirmation icon. */
interface ImageFingerprint {
  length: number;
  first: number;
  mid: number;
  last: number;
}

// ── Bridge class ──────────────────────────────────────────────────────────────

export class EvenHubBridge {
  private bridge: EvenAppBridgeType | null = null;

  // ── Image queue ──────────────────────────────────────────────────────────
  private imageQueue: ImageRawDataUpdate[] = [];
  private isSendingImage = false;

  // ── Image link health ────────────────────────────────────────────────────
  /** True when recent average BLE send duration exceeds LINK_SLOW_THRESHOLD_MS. */
  private imageLinkSlow = false;
  private recentSendDurations: number[] = [];

  // ── Image dirty tracking ─────────────────────────────────────────────────
  /** Per-container fingerprint of the last successfully sent image. */
  private lastSentImageByContainer: Map<number, ImageFingerprint> = new Map();

  // ── Text queue / gate ────────────────────────────────────────────────────
  private textResumeTimer: ReturnType<typeof setTimeout> | null = null;
  /** Keyed by String(containerID) — Map preserves insertion order for FIFO drain. */
  private textQueue: Map<string, TextQueueEntry> = new Map();
  private isSendingText = false;
  /** Last successfully sent content per container key — prevents redundant sends. */
  private lastSentTextByKey: Map<string, string> = new Map();

  // ── Event subscriptions ──────────────────────────────────────────────────
  private unsubscribeEvents: (() => void) | null = null;
  private unsubscribeLaunchSource: (() => void) | null = null;
  private launchSource: LaunchSource | null = null;
  private launchSourceHandlers = new Set<LaunchSourceHandler>();

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** @param timeoutMs If the bridge is not ready after this many ms, treat as no bridge (e.g. in a normal browser). Use a longer default so the Even App WebView has time to inject the bridge. */
  async init(timeoutMs: number = 10000): Promise<void> {
    try {
      this.unsubscribeLaunchSource?.();
      this.unsubscribeLaunchSource = null;
      const bridgePromise = waitForEvenAppBridge();
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Bridge timeout')), timeoutMs)
      );
      this.bridge = await Promise.race([bridgePromise, timeoutPromise]);
      try {
        this.unsubscribeLaunchSource = this.bridge.onLaunchSource((source) => {
          this.launchSource = source;
          for (const handler of this.launchSourceHandlers) {
            try {
              handler(source);
            } catch (err) {
              console.error('[EvenHubBridge] Launch source handler error:', err);
            }
          }
        });
      } catch (err) {
        console.warn('[EvenHubBridge] Launch source subscription error:', err);
        this.unsubscribeLaunchSource = null;
      }
      console.log('[EvenHubBridge] Bridge ready.');
    } catch (err) {
      console.warn('[EvenHubBridge] Bridge init failed (running outside Even Hub?):', err);
      this.bridge = null;
    }
  }

  hasBridge(): boolean {
    return this.bridge != null;
  }

  getLaunchSource(): LaunchSource | null {
    return this.launchSource;
  }

  subscribeLaunchSource(handler: LaunchSourceHandler, emitCurrent = true): () => void {
    this.launchSourceHandlers.add(handler);
    if (emitCurrent && this.launchSource) {
      try {
        handler(this.launchSource);
      } catch (err) {
        console.error('[EvenHubBridge] Launch source handler error:', err);
      }
    }
    return () => {
      this.launchSourceHandlers.delete(handler);
    };
  }

  // ── Device info ───────────────────────────────────────────────────────────

  /** Real glasses (G1/G2) may need raw image data; simulator decodes PNG. */
  async getDeviceInfo(): Promise<DeviceInfo | null> {
    if (!this.bridge) return null;
    try {
      return await this.bridge.getDeviceInfo();
    } catch {
      return null;
    }
  }

  isRealGlasses(device: DeviceInfo | null): boolean {
    if (!device) return false;
    return device.model === DeviceModel.G1 || device.model === DeviceModel.G2;
  }

  // ── Local storage ─────────────────────────────────────────────────────────

  async getLocalStorage(key: string): Promise<string> {
    if (!this.bridge) return '';
    try {
      return await this.bridge.getLocalStorage(key);
    } catch (err) {
      console.warn('[EvenHubBridge] getLocalStorage error:', err);
      return '';
    }
  }

  async setLocalStorage(key: string, value: string): Promise<boolean> {
    if (!this.bridge) return false;
    try {
      return await this.bridge.setLocalStorage(key, value);
    } catch (err) {
      console.error('[EvenHubBridge] setLocalStorage error:', err);
      return false;
    }
  }

  // ── Page lifecycle ────────────────────────────────────────────────────────

  async setupPage(container: CreateStartUpPageContainer): Promise<SetupPageResult> {
    if (!this.bridge) {
      console.log('[EvenHubBridge] No bridge — skipping setupPage.');
      return { success: false, code: null };
    }

    try {
      const result = StartUpPageCreateResult.normalize(await this.bridge.createStartUpPageContainer(container));
      const success = result === StartUpPageCreateResult.success;
      if (!success) {
        console.error('[EvenHubBridge] createStartUpPageContainer failed:', result);
      }
      return { success, code: result };
    } catch (err) {
      console.error('[EvenHubBridge] createStartUpPageContainer error:', err);
      return { success: false, code: null };
    }
  }

  async updatePage(container: RebuildPageContainer): Promise<boolean> {
    if (!this.bridge) {
      console.log('[EvenHubBridge] No bridge — skipping updatePage.');
      return false;
    }

    try {
      const success = await this.bridge.rebuildPageContainer(container);
      if (!success) {
        console.warn('[EvenHubBridge] rebuildPageContainer returned false.');
      }
      return success;
    } catch (err) {
      console.error('[EvenHubBridge] rebuildPageContainer error:', err);
      return false;
    }
  }

  // ── Text updates (queued + gated) ─────────────────────────────────────────

  /**
   * Enqueue a text container update.
   * Updates for the same container coalesce — only the newest content is sent.
   * Sends are gated when the BLE image link is under pressure (imageLinkSlow).
   */
  updateText(containerID: number, containerName: string, content: string): void {
    if (!this.bridge) return;

    const key = String(containerID);
    this.textQueue.set(key, {
      key,
      containerID,
      containerName,
      content,
      enqueuedAtMs: Date.now(),
    });
    void this.processTextQueue();
  }

  private async processTextQueue(): Promise<void> {
    if (this.isSendingText || !this.bridge) return;

    // Cancel any pending gate retry; we'll reschedule below if still blocked.
    if (this.textResumeTimer !== null) {
      clearTimeout(this.textResumeTimer);
      this.textResumeTimer = null;
    }

    this.isSendingText = true;

    while (this.textQueue.size > 0) {
      // ── Link health gate ──────────────────────────────────────────────────
      // Gate on imageLinkSlow alone — do NOT require a separate survival-mode
      // flag, which was a sibling-project bug that allowed text to overtake
      // images under moderate link pressure.
      if (this.imageLinkSlow) {
        this.textResumeTimer = setTimeout(() => {
          this.textResumeTimer = null;
          void this.processTextQueue();
        }, TEXT_GATE_RETRY_MS);
        break;
      }

      // ── Dequeue next entry (FIFO via Map insertion order) ─────────────────
      const iter = this.textQueue.entries().next();
      if (iter.done) break;
      const [key, entry] = iter.value as [string, TextQueueEntry];
      this.textQueue.delete(key);

      // ── Deduplication: skip if content hasn't changed ─────────────────────
      if (this.lastSentTextByKey.get(key) === entry.content) continue;

      try {
        await this.bridge.textContainerUpgrade(
          new TextContainerUpgrade({
            containerID: entry.containerID,
            containerName: entry.containerName,
            content: entry.content,
          }),
        );
        this.lastSentTextByKey.set(key, entry.content);
      } catch (err) {
        console.error('[EvenHubBridge] textContainerUpgrade error:', err);
      }
    }

    this.isSendingText = false;
  }

  // ── Image updates (coalesced + dirty-checked) ─────────────────────────────

  /**
   * Enqueue an image update.
   * - Coalesces: replaces an existing queued entry for the same container.
   * - Caps: drops the oldest entry if the queue exceeds IMAGE_QUEUE_MAX.
   * - Dirty-checks: skips sending if bytes are identical to last successful send.
   */
  async updateBoardImage(data: ImageRawDataUpdate): Promise<void> {
    const existingIdx = this.imageQueue.findIndex(item => item.containerID === data.containerID);
    if (existingIdx >= 0) {
      // Coalesce: replace in-place so queue length stays constant.
      this.imageQueue[existingIdx] = data;
    } else {
      if (this.imageQueue.length >= IMAGE_QUEUE_MAX) {
        // Drop the oldest entry to prevent unbounded growth.
        this.imageQueue.shift();
      }
      this.imageQueue.push(data);
    }
    void this.processImageQueue();
  }

  private async processImageQueue(): Promise<void> {
    if (this.isSendingImage || !this.bridge) return;
    this.isSendingImage = true;

    while (this.imageQueue.length > 0) {
      const data = this.imageQueue.shift()!;

      // Skip send if image content is identical to what was last sent.
      if (!this.imageDataChanged(data.containerID, data)) continue;

      const startMs = Date.now();
      try {
        const result = await this.bridge.updateImageRawData(data);
        if (!ImageRawDataUpdateResult.isSuccess(result)) {
          console.warn('[EvenHubBridge] Image update not successful:', result);
        } else {
          this.updateImageFingerprint(data);
          this.recordSendDuration(Date.now() - startMs);
        }
      } catch (err) {
        console.error('[EvenHubBridge] Image update error:', err);
      }
    }

    // Queue drained — link pressure resolved; reset slow flag.
    this.imageLinkSlow = false;
    this.recentSendDurations = [];
    this.isSendingImage = false;
  }

  // ── Image dirty tracking helpers ──────────────────────────────────────────

  private imageDataChanged(containerID: number | undefined, data: ImageRawDataUpdate): boolean {
    if (containerID === undefined) return true;
    const prev = this.lastSentImageByContainer.get(containerID);
    if (!prev) return true;
    const fp = this.buildFingerprint(data);
    if (!fp) return true;
    return prev.length !== fp.length || prev.first !== fp.first || prev.mid !== fp.mid || prev.last !== fp.last;
  }

  private updateImageFingerprint(data: ImageRawDataUpdate): void {
    const containerID = data.containerID;
    if (containerID === undefined) return;
    const fp = this.buildFingerprint(data);
    if (fp) this.lastSentImageByContainer.set(containerID, fp);
  }

  private buildFingerprint(data: ImageRawDataUpdate): ImageFingerprint | null {
    const imageData = data.imageData;
    if (Array.isArray(imageData)) {
      const arr = imageData as number[];
      const midIdx = Math.floor(arr.length / 2);
      const first = arr[0];
      const mid = arr[midIdx];
      const last = arr[arr.length - 1];
      return { length: arr.length, first: first ?? -1, mid: mid ?? -1, last: last ?? -1 };
    }
    if (typeof imageData === 'string') {
      const midIdx = Math.floor(imageData.length / 2);
      return {
        length: imageData.length,
        first: imageData.length > 0 ? imageData.charCodeAt(0) : -1,
        mid: imageData.length > 0 ? imageData.charCodeAt(midIdx) : -1,
        last: imageData.length > 0 ? imageData.charCodeAt(imageData.length - 1) : -1,
      };
    }
    return null;
  }

  /**
   * Reset per-container image fingerprints.
   * Call after a full page rebuild so the next image send is never suppressed.
   */
  resetImageDirtyTracking(): void {
    this.lastSentImageByContainer.clear();
  }

  // ── Link health tracking ──────────────────────────────────────────────────

  private recordSendDuration(durationMs: number): void {
    this.recentSendDurations.push(durationMs);
    if (this.recentSendDurations.length > LINK_SLOW_SAMPLE_SIZE) {
      this.recentSendDurations.shift();
    }
    if (this.recentSendDurations.length === LINK_SLOW_SAMPLE_SIZE) {
      const avg = this.recentSendDurations.reduce((a: number, b: number) => a + b, 0) / LINK_SLOW_SAMPLE_SIZE;
      this.imageLinkSlow = avg > LINK_SLOW_THRESHOLD_MS;
    }
  }

  // ── Event subscription ────────────────────────────────────────────────────

  subscribeEvents(handler: EvenHubEventHandler): void {
    this.unsubscribeEvents?.();

    if (!this.bridge) {
      console.log('[EvenHubBridge] No bridge — skipping event subscription.');
      return;
    }

    try {
      this.unsubscribeEvents = this.bridge.onEvenHubEvent((event) => {
        handler(event);
      });
    } catch (err) {
      console.error('[EvenHubBridge] Event subscription error:', err);
      this.unsubscribeEvents = null;
    }
  }

  // ── Shutdown ──────────────────────────────────────────────────────────────

  async shutdown(): Promise<void> {
    this.unsubscribeEvents?.();
    this.unsubscribeEvents = null;
    this.unsubscribeLaunchSource?.();
    this.unsubscribeLaunchSource = null;
    this.launchSourceHandlers.clear();

    if (this.textResumeTimer !== null) {
      clearTimeout(this.textResumeTimer);
      this.textResumeTimer = null;
    }

    if (this.bridge) {
      try {
        await this.bridge.shutDownPageContainer(0);
      } catch (err) {
        console.error('[EvenHubBridge] shutDown error:', err);
      }
    }
  }
}
