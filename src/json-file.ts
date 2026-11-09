import fs from "node:fs";
import path from "node:path";

const pause = new Int32Array(new SharedArrayBuffer(4));

function sleepMs(ms: number): void {
  Atomics.wait(pause, 0, 0, ms);
}

export function withLock<T>(dir: string, lockName: string, fn: () => T): T {
  fs.mkdirSync(dir, { recursive: true });
  const lockPath = path.join(dir, lockName);
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      try {
        return fn();
      } finally {
        fs.closeSync(fd);
        fs.rmSync(lockPath, { force: true });
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw err;
      sleepMs(10);
    }
  }
  throw new Error(`timed out locking ${lockPath}`);
}

export function updateJson<T>(
  dir: string,
  file: string,
  init: () => T,
  mutate: (data: T) => void,
): T {
  return withLock(dir, `${file}.lock`, () => {
    const full = path.join(dir, file);
    const data: T = fs.existsSync(full)
      ? (JSON.parse(fs.readFileSync(full, "utf8")) as T)
      : init();
    mutate(data);
    const tmp = `${full}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, full);
    return data;
  });
}

export function readJson<T>(dir: string, file: string): T | undefined {
  const full = path.join(dir, file);
  if (!fs.existsSync(full)) return undefined;
  return JSON.parse(fs.readFileSync(full, "utf8")) as T;
}
