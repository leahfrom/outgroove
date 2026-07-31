import type { ScanJobDto } from "../../shared/contracts/api";
import type { CatalogDatabase } from "../adapters/database/catalog-database";
import type { ScanLibrary, ScanProgress } from "../application/scan-library";

type Listener = (job: ScanJobDto) => void;

export class ScanJobCoordinator {
  private readonly controllers = new Map<string, AbortController>();
  private readonly listeners = new Set<Listener>();

  constructor(
    private readonly database: CatalogDatabase,
    private readonly scanner: ScanLibrary,
  ) {}

  onUpdated(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(rootId: string): ScanJobDto {
    if (!this.database.getLibraryRoot(rootId))
      throw new Error("Library root does not exist.");
    const active = this.database.getActiveScanJob(rootId);
    if (active) return active;
    const job = this.database.createScanJob(rootId);
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    queueMicrotask(() => void this.run(job.id, rootId, controller));
    return job;
  }

  cancel(jobId: string): ScanJobDto {
    const job = this.database.getScanJob(jobId);
    if (!job) throw new Error("Scan job does not exist.");
    const controller = this.controllers.get(jobId);
    if (!controller || !["queued", "running"].includes(job.state)) return job;
    const cancelling = this.save(jobId, {
      state: "cancelling",
      detail: "Cancelling safely…",
    });
    controller.abort();
    return cancelling;
  }

  latest(): ScanJobDto | null {
    return this.database.getLatestScanJob();
  }

  private async run(
    jobId: string,
    rootId: string,
    controller: AbortController,
  ): Promise<void> {
    if (controller.signal.aborted) {
      this.save(jobId, {
        state: "cancelled",
        detail: "Scan cancelled. Your previous Library remains available.",
        error: null,
        finished: true,
      });
      this.controllers.delete(jobId);
      return;
    }
    this.save(jobId, { state: "running", detail: "Discovering audio files…" });
    try {
      let lastPersistedProgress = 0;
      let lastPhase: ScanProgress["phase"] | undefined;
      const result = await this.scanner.execute(
        rootId,
        (progress) => {
          const now = Date.now();
          const completed =
            progress.phase === "discovery"
              ? progress.discovered
              : progress.completed;
          const total = progress.phase === "discovery" ? 0 : progress.total;
          const detail =
            progress.phase === "discovery"
              ? `Discovering: ${progress.discovered} audio ${progress.discovered === 1 ? "file" : "files"} found, ${progress.folderErrors} folder ${progress.folderErrors === 1 ? "problem" : "problems"}.`
              : progress.total === 0
                ? "Metadata: no changed audio files to read."
                : `Reading metadata: ${progress.path}`;
          if (
            progress.phase !== lastPhase ||
            (progress.phase === "metadata" && completed === total) ||
            now - lastPersistedProgress >= 100
          ) {
            lastPersistedProgress = now;
            lastPhase = progress.phase;
            this.save(jobId, { completed, total, detail });
          }
        },
        controller.signal,
      );
      this.save(jobId, {
        state: "completed",
        completed: result.parsed + result.errors,
        total: result.parsed + result.errors,
        detail: "Scan complete",
        result,
        error: null,
        finished: true,
      });
    } catch (error) {
      const wasCancelled =
        this.controllers.get(jobId)?.signal.aborted === true ||
        (error instanceof DOMException && error.name === "AbortError");
      if (wasCancelled)
        this.save(jobId, {
          state: "cancelled",
          detail: "Scan cancelled. Your previous Library remains available.",
          error: null,
          finished: true,
        });
      else
        this.save(jobId, {
          state: "failed",
          detail: "Scan failed",
          error: error instanceof Error ? error.message : String(error),
          finished: true,
        });
    } finally {
      this.controllers.delete(jobId);
    }
  }

  private save(
    jobId: string,
    update: Parameters<CatalogDatabase["updateScanJob"]>[1],
  ): ScanJobDto {
    const job = this.database.updateScanJob(jobId, update);
    for (const listener of this.listeners) listener(job);
    return job;
  }
}
