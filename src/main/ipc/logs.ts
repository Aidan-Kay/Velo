import { app, ipcMain, shell } from "electron";
import * as fs from "fs";
import * as fsPromises from "fs/promises";
import * as path from "path";

import type { LogEntry, LogLevel, LogQuery } from "../../shared/types";
import type { IpcDeps } from "./types";

const DEFAULT_TAIL_BYTES = 256 * 1024;
const DEFAULT_LIMIT = 500;
const VALID_LEVELS: ReadonlySet<LogLevel> = new Set(["error", "warn", "info", "debug", "verbose", "silly"]);

function logFilePath(): string {
  return path.join(app.getPath("logs"), "main.log");
}

/**
 * electron-log default line format: `[YYYY-MM-DD HH:MM:SS.mmm] [level] message`.
 * Lines that don't match this header are treated as continuation of the
 * previous entry (multi-line stack traces, etc.).
 */
const LINE_RE = /^\[(?<ts>[^\]]+)\] \[(?<level>\w+)\]\s*(?<msg>.*)$/;
const SOURCE_RE = /^\[([^\]]+)\]\s*/;

function parseLogTail(text: string): LogEntry[] {
  const lines = text.split(/\r?\n/);
  const entries: LogEntry[] = [];

  for (const line of lines) {
    if (!line) continue;
    const m = LINE_RE.exec(line);
    if (m && m.groups) {
      const levelRaw = m.groups.level.toLowerCase();
      const level: LogLevel = (VALID_LEVELS.has(levelRaw as LogLevel) ? levelRaw : "info") as LogLevel;
      const msg = m.groups.msg ?? "";
      const sourceMatch = SOURCE_RE.exec(msg);
      const source = sourceMatch ? sourceMatch[1] : "main";
      const message = sourceMatch ? msg.slice(sourceMatch[0].length) : msg;
      entries.push({
        ts: m.groups.ts,
        level,
        source,
        message,
        raw: line,
      });
    } else if (entries.length > 0) {
      const last = entries[entries.length - 1];
      last.message = last.message ? `${last.message}\n${line}` : line;
      last.raw = `${last.raw}\n${line}`;
    }
  }

  return entries;
}

async function readTail(filePath: string, maxBytes: number): Promise<string> {
  const handle = await fsPromises.open(filePath, "r");
  try {
    const stat = await handle.stat();
    const size = stat.size;
    const start = Math.max(0, size - maxBytes);
    const length = size - start;
    const buf = Buffer.alloc(length);
    await handle.read(buf, 0, length, start);
    return buf.toString("utf-8");
  } finally {
    await handle.close();
  }
}

export function setupLogsIpc(_deps: IpcDeps): void {
  ipcMain.handle("get-log-entries", async (_event, query: LogQuery = {}): Promise<LogEntry[]> => {
    const filePath = logFilePath();
    if (!fs.existsSync(filePath)) return [];

    const tailBytes = DEFAULT_TAIL_BYTES + Math.max(0, query.offsetFromEnd ?? 0);
    let text: string;
    try {
      text = await readTail(filePath, tailBytes);
    } catch (err) {
      console.warn("[logs] Failed to read log file:", (err as Error).message);
      return [];
    }

    let entries = parseLogTail(text);

    if (query.levels && query.levels.length > 0) {
      const set = new Set(query.levels);
      entries = entries.filter((e) => set.has(e.level));
    }

    if (query.search && query.search.trim()) {
      const needle = query.search.toLowerCase();
      entries = entries.filter((e) => e.message.toLowerCase().includes(needle) || e.source.toLowerCase().includes(needle));
    }

    const limit = query.limit ?? DEFAULT_LIMIT;
    if (entries.length > limit) {
      entries = entries.slice(entries.length - limit);
    }
    return entries;
  });

  ipcMain.handle("open-log-file", async () => {
    const filePath = logFilePath();
    await shell.openPath(filePath);
    return { success: true };
  });

  ipcMain.handle("clear-log-file", async () => {
    const filePath = logFilePath();
    if (!fs.existsSync(filePath)) return { success: true };
    try {
      await fsPromises.truncate(filePath, 0);
      return { success: true };
    } catch (err) {
      console.error("[logs] Failed to truncate log file:", (err as Error).message);
      return { success: false };
    }
  });
}
