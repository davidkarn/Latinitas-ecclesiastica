import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

/**
 * Writes JSON files into a staging directory next to the final output, then swaps it into place
 * with renames on commit(), so nginx never serves a half-written build.
 */
export class Output {
  readonly staging: string;
  readonly tmp: string;
  private dirs = new Set<string>();
  files = 0;
  bytes = 0;

  constructor(readonly finalDir: string, readonly buildId: string, readonly gzip: boolean) {
    this.staging = `${finalDir}.staging-${buildId}`;
    this.tmp = `${finalDir}.tmp-${buildId}`;
    fs.rmSync(this.staging, { recursive: true, force: true });
    fs.rmSync(this.tmp, { recursive: true, force: true });
    fs.mkdirSync(this.staging, { recursive: true });
    fs.mkdirSync(this.tmp, { recursive: true });
  }

  /** Write `data` as JSON to `rel` (a path from src/api/paths.ts) inside the build. */
  json(rel: string, data: unknown): void {
    const file = path.join(this.staging, rel);
    const dir = path.dirname(file);
    if (!this.dirs.has(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      this.dirs.add(dir);
    }
    const body = Buffer.from(JSON.stringify(data));
    fs.writeFileSync(file, body);
    if (this.gzip) fs.writeFileSync(`${file}.gz`, gzipSync(body, { level: 9 }));
    this.files++;
    this.bytes += body.length;
  }

  /** Place a binary file (audio) at `rel`: hard link when possible (no extra disk), copy otherwise. */
  link(rel: string, src: string): void {
    const file = path.join(this.staging, rel);
    const dir = path.dirname(file);
    if (!this.dirs.has(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      this.dirs.add(dir);
    }
    try {
      fs.linkSync(src, file);
    } catch {
      fs.copyFileSync(src, file);
    }
    this.files++;
  }

  /** Atomically replace finalDir with the staged build and delete scratch files. */
  commit(): void {
    const old = `${this.finalDir}.old-${this.buildId}`;
    if (fs.existsSync(this.finalDir)) fs.renameSync(this.finalDir, old);
    fs.renameSync(this.staging, this.finalDir);
    fs.rmSync(old, { recursive: true, force: true });
    fs.rmSync(this.tmp, { recursive: true, force: true });
  }

  /** Remove staging and scratch files after a failed build; the live output is untouched. */
  abort(): void {
    fs.rmSync(this.staging, { recursive: true, force: true });
    fs.rmSync(this.tmp, { recursive: true, force: true });
  }
}

/**
 * Spills records into per-bucket JSONL files on disk so large sources can be regrouped
 * (e.g. by slug) without holding everything in memory.
 */
export class Buckets<T> {
  private buf = new Map<string, string[]>();
  private buffered = 0;

  constructor(private dir: string, private flushAt = 50_000) {
    fs.mkdirSync(dir, { recursive: true });
  }

  add(bucket: string, record: T): void {
    let b = this.buf.get(bucket);
    if (!b) this.buf.set(bucket, (b = []));
    b.push(JSON.stringify(record));
    if (++this.buffered >= this.flushAt) this.flush();
  }

  flush(): void {
    for (const [bucket, lines] of this.buf) fs.appendFileSync(this.file(bucket), lines.join("\n") + "\n");
    this.buf.clear();
    this.buffered = 0;
  }

  names(): string[] {
    this.flush();
    return fs.readdirSync(this.dir).filter(f => f.endsWith(".jsonl")).map(f => decodeURIComponent(f.slice(0, -6))).sort();
  }

  read(bucket: string): T[] {
    const text = fs.readFileSync(this.file(bucket), "utf8");
    return text.split("\n").filter(Boolean).map(l => JSON.parse(l) as T);
  }

  private file(bucket: string): string {
    return path.join(this.dir, `${encodeURIComponent(bucket)}.jsonl`);
  }
}
