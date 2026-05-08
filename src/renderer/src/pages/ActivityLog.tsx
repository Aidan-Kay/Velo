import { Button } from "@shared/components/ui/button";
import { Card } from "@shared/components/ui/card";
import { Checkbox } from "@shared/components/ui/checkbox";
import { Input } from "@shared/components/ui/input";
import { Label } from "@shared/components/ui/label";
import { Switch } from "@shared/components/ui/switch";
import React, { useCallback, useEffect, useRef, useState } from "react";
import type { LogEntry, LogLevel } from "../../../shared/types";
import { DeleteConfirmModal } from "../components/DeleteConfirmModal";
import { useToast } from "../context/ToastContext";

const ALL_LEVELS: LogLevel[] = ["error", "warn", "info", "debug", "verbose", "silly"];

const LEVEL_CLASS: Record<LogLevel, string> = {
  error: "text-red-400",
  warn: "text-yellow-400",
  info: "text-foreground",
  debug: "text-muted-foreground",
  verbose: "text-muted-foreground",
  silly: "text-muted-foreground",
};

const ActivityLog: React.FC = () => {
  const { addToast } = useToast();
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [levels, setLevels] = useState<LogLevel[]>(["error", "warn", "info"]);
  const [search, setSearch] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [loading, setLoading] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await window.api.getLogEntries({ levels, search, limit: 500 });
      setEntries(result);
    } catch {
      addToast("Failed to load logs", "error");
    } finally {
      setLoading(false);
    }
  }, [levels, search, addToast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(() => {
      load();
    }, 5000);
    return () => clearInterval(t);
  }, [autoRefresh, load]);

  const toggleLevel = (level: LogLevel) => {
    setLevels((prev) => (prev.includes(level) ? prev.filter((l) => l !== level) : [...prev, level]));
  };

  const handleOpen = async () => {
    try {
      await window.api.openLogFile();
    } catch {
      addToast("Failed to open log file", "error");
    }
  };

  const handleClear = async () => {
    setConfirmClear(false);
    try {
      const res = await window.api.clearLogFile();
      if (res.success) {
        addToast("Log cleared", "success");
        setEntries([]);
      } else {
        addToast("Failed to clear log", "error");
      }
    } catch {
      addToast("Failed to clear log", "error");
    }
  };

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold text-foreground mr-2">Activity Log</h2>

        <Input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-64" />

        <div className="flex items-center gap-3">
          {ALL_LEVELS.map((level) => (
            <label key={level} className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
              <Checkbox checked={levels.includes(level)} onCheckedChange={() => toggleLevel(level)} />
              <span className={LEVEL_CLASS[level]}>{level}</span>
            </label>
          ))}
        </div>

        <div className="flex items-center gap-2 text-xs">
          <Label className="text-xs">Auto-refresh</Label>
          <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} />
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" onClick={load} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </Button>
          <Button variant="outline" onClick={handleOpen}>
            Open file
          </Button>
          <Button variant="outline" onClick={() => setConfirmClear(true)}>
            Clear
          </Button>
        </div>
      </div>

      <Card className="p-0 flex-1 min-h-0 flex flex-col overflow-hidden">
        <div ref={scrollRef} className="overflow-auto flex-1 font-mono text-xs">
          {entries.length === 0 ? (
            <div className="text-muted-foreground text-sm py-12 text-center">No log entries</div>
          ) : (
            <ul className="divide-y divide-border/40">
              {entries.map((e, i) => (
                <li key={i} className="px-3 py-1.5 flex gap-3">
                  <span className="text-muted-foreground whitespace-nowrap">{e.ts}</span>
                  <span className={`uppercase font-semibold w-12 ${LEVEL_CLASS[e.level]}`}>{e.level}</span>
                  <span className="text-muted-foreground whitespace-nowrap">[{e.source}]</span>
                  <span className="whitespace-pre-wrap break-words flex-1">{e.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      {confirmClear && (
        <DeleteConfirmModal
          title="Clear log file"
          message="Truncate the on-disk log file? This cannot be undone."
          confirmLabel="Clear"
          onConfirm={handleClear}
          onCancel={() => setConfirmClear(false)}
        />
      )}
    </div>
  );
};

export default React.memo(ActivityLog);
