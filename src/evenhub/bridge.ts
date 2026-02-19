/**
 * EvenHubBridge — SDK lifecycle and container operations.
 */

import {
  waitForEvenAppBridge,
  TextContainerUpgrade,
  type EvenAppBridge as EvenAppBridgeType,
  type CreateStartUpPageContainer,
  type RebuildPageContainer,
  type ImageRawDataUpdate,
  type EvenHubEvent,
  type DeviceInfo,
  ImageRawDataUpdateResult,
  DeviceModel,
} from '@evenrealities/even_hub_sdk';

export type EvenHubEventHandler = (event: EvenHubEvent) => void;

export class EvenHubBridge {
  private bridge: EvenAppBridgeType | null = null;
  private imageQueue: ImageRawDataUpdate[] = [];
  private isSendingImage = false;
  private unsubscribeEvents: (() => void) | null = null;

  /** @param timeoutMs If the bridge is not ready after this many ms, treat as no bridge (e.g. in a normal browser). Use a longer default so the Even App WebView has time to inject the bridge. */
  async init(timeoutMs: number = 10000): Promise<void> {
    try {
      const bridgePromise = waitForEvenAppBridge();
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Bridge timeout')), timeoutMs)
      );
      this.bridge = await Promise.race([bridgePromise, timeoutPromise]);
      console.log('[EvenHubBridge] Bridge ready.');
    } catch (err) {
      console.warn('[EvenHubBridge] Bridge init failed (running outside Even Hub?):', err);
      this.bridge = null;
    }
  }

  hasBridge(): boolean {
    return this.bridge != null;
  }

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

  async setupPage(container: CreateStartUpPageContainer): Promise<boolean> {
    if (!this.bridge) {
      console.log('[EvenHubBridge] No bridge — skipping setupPage.');
      return false;
    }

    try {
      const result = await this.bridge.createStartUpPageContainer(container);
      const success = result === 0;
      if (!success) {
        console.error('[EvenHubBridge] createStartUpPageContainer failed:', result);
      }
      return success;
    } catch (err) {
      console.error('[EvenHubBridge] createStartUpPageContainer error:', err);
      return false;
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

  async updateText(containerID: number, containerName: string, content: string): Promise<boolean> {
    if (!this.bridge) return false;

    try {
      return await this.bridge.textContainerUpgrade(
        new TextContainerUpgrade({
          containerID,
          containerName,
          content,
        }),
      );
    } catch (err) {
      console.error('[EvenHubBridge] textContainerUpgrade error:', err);
      return false;
    }
  }

  async updateBoardImage(data: ImageRawDataUpdate): Promise<void> {
    this.imageQueue.push(data);
    await this.processImageQueue();
  }

  private async processImageQueue(): Promise<void> {
    if (this.isSendingImage || !this.bridge) return;
    this.isSendingImage = true;

    while (this.imageQueue.length > 0) {
      const data = this.imageQueue.shift()!;
      try {
        const result = await this.bridge.updateImageRawData(data);
        if (!ImageRawDataUpdateResult.isSuccess(result)) {
          console.warn('[EvenHubBridge] Image update not successful:', result);
        }
      } catch (err) {
        console.error('[EvenHubBridge] Image update error:', err);
      }
    }

    this.isSendingImage = false;
  }

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

  async shutdown(): Promise<void> {
    this.unsubscribeEvents?.();
    this.unsubscribeEvents = null;

    if (this.bridge) {
      try {
        await this.bridge.shutDownPageContainer(0);
      } catch (err) {
        console.error('[EvenHubBridge] shutDown error:', err);
      }
    }
  }
}
