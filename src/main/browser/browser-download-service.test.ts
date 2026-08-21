import { EventEmitter } from "node:events";
import { describe, expect, test, vi } from "vite-plus/test";
import type { BrowserDownloadRecord } from "../../shared/browser-download";
import type { BrowserDownloadStore } from "./browser-download-store";
import { BrowserDownloadService } from "./browser-download-service";

class MemoryDownloadStore implements BrowserDownloadStore {
  records = new Map<string, BrowserDownloadRecord>();
  async list() {
    return [...this.records.values()];
  }
  async upsert(record: BrowserDownloadRecord) {
    this.records.set(record.id, record);
  }
  async remove(downloadId: string) {
    this.records.delete(downloadId);
  }
  async clear() {
    this.records.clear();
  }
}

class FakeDownloadItem extends EventEmitter {
  cancelled = false;
  paused = false;
  savePath = "";
  receivedBytes = 0;
  totalBytes = 100;
  canResume() {
    return this.paused;
  }
  cancel() {
    this.cancelled = true;
  }
  getFilename() {
    return "report.pdf";
  }
  getReceivedBytes() {
    return this.receivedBytes;
  }
  getTotalBytes() {
    return this.totalBytes;
  }
  getURLChain() {
    return ["https://example.com/download?secret=1"];
  }
  isPaused() {
    return this.paused;
  }
  pause() {
    this.paused = true;
  }
  resume() {
    this.paused = false;
  }
  setSavePath(path: string) {
    this.savePath = path;
  }
}

class FakeSession extends EventEmitter {}

const identity = {
  browserConversationId: "conversation-1",
  browserViewScopeId: "window-session-1",
  browserTabId: "browser-tab-1",
};

function fixture(options: { agentControlled?: boolean } = {}) {
  const store = new MemoryDownloadStore();
  const snapshots: BrowserDownloadRecord[][] = [];
  const service = new BrowserDownloadService({
    downloadsDirectory: "/tmp/nodex-download-tests",
    idFactory: () => "download-1",
    isAgentControlled: () => options.agentControlled === true,
    now: () => 100,
    onSnapshot: (snapshot) => snapshots.push(snapshot.downloads),
    resolveIdentity: () => identity,
    shell: {
      openPath: vi.fn(async () => ""),
      showItemInFolder: vi.fn(),
    },
    store,
  });
  return { service, session: new FakeSession(), snapshots, store };
}

describe("BrowserDownloadService", () => {
  test("tracks progress and persists sanitized source origin", async () => {
    const test = fixture();
    await test.service.initialize(test.session as never);
    const item = new FakeDownloadItem();
    const event = { preventDefault: vi.fn() };
    test.session.emit("will-download", event, item, { id: 7 });
    await Promise.resolve();

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(item.savePath.endsWith("report.pdf")).toBe(true);
    expect(test.store.records.get("download-1")).toMatchObject({
      sourceOrigin: "https://example.com",
      status: "starting",
    });
    item.receivedBytes = 50;
    item.emit("updated", {}, "progressing");
    await Promise.resolve();
    expect(test.service.snapshot().downloads[0]).toMatchObject({
      receivedBytes: 50,
      status: "progressing",
    });
  });

  test("requires and consumes a 10-second agent download grant", async () => {
    const test = fixture({ agentControlled: true });
    await test.service.initialize(test.session as never);
    const denied = new FakeDownloadItem();
    const deniedEvent = { preventDefault: vi.fn() };
    test.session.emit("will-download", deniedEvent, denied, { id: 7 });
    expect(deniedEvent.preventDefault).toHaveBeenCalledOnce();
    expect(denied.cancelled).toBe(true);

    test.service.grantAgentDownload(identity, "https://example.com/download?secret=1");
    const allowed = new FakeDownloadItem();
    const allowedEvent = { preventDefault: vi.fn() };
    test.session.emit("will-download", allowedEvent, allowed, { id: 7 });
    expect(allowedEvent.preventDefault).not.toHaveBeenCalled();

    const replay = new FakeDownloadItem();
    const replayEvent = { preventDefault: vi.fn() };
    test.session.emit("will-download", replayEvent, replay, { id: 7 });
    expect(replayEvent.preventDefault).toHaveBeenCalledOnce();
  });
});
