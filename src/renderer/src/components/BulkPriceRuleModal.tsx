import { Button } from "@shared/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@shared/components/ui/dialog";
import { Input } from "@shared/components/ui/input";
import { Label } from "@shared/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@shared/components/ui/select";
import React, { useEffect, useMemo, useState } from "react";
import type { PriceRulePreset } from "../../../shared/types";
import { useToast } from "../context/ToastContext";

interface BulkPriceRuleModalProps {
  presets: PriceRulePreset[];
  onClose: () => void;
  onComplete: () => void;
}

interface ProgressState {
  total: number;
  completed: number;
  failed: number;
  done: boolean;
}

const CUSTOM_VALUE = "__custom__";

export const BulkPriceRuleModal: React.FC<BulkPriceRuleModalProps> = ({ presets, onClose, onComplete }) => {
  const { addToast } = useToast();
  const [selected, setSelected] = useState<string>(presets[0]?.id ?? CUSTOM_VALUE);
  const [percentOff, setPercentOff] = useState<number>(presets[0]?.percentOff ?? 5);
  const [olderThanDays, setOlderThanDays] = useState<number>(presets[0]?.olderThanDays ?? 7);
  const [matched, setMatched] = useState<number | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ProgressState | null>(null);

  const selectedPreset = useMemo(
    () => (selected === CUSTOM_VALUE ? null : (presets.find((p) => p.id === selected) ?? null)),
    [selected, presets],
  );

  useEffect(() => {
    if (selectedPreset) {
      setPercentOff(selectedPreset.percentOff);
      setOlderThanDays(selectedPreset.olderThanDays);
    }
  }, [selectedPreset]);

  // Live dry-run preview as inputs change
  useEffect(() => {
    if (running) return;
    let cancelled = false;
    setPreviewing(true);
    setMatched(null);
    const id = setTimeout(() => {
      window.api
        .applyBulkPriceRule({ percentOff, olderThanDays, dryRun: true })
        .then((res) => {
          if (!cancelled) setMatched(res.matched);
        })
        .catch(() => {
          if (!cancelled) setMatched(null);
        })
        .finally(() => {
          if (!cancelled) setPreviewing(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [percentOff, olderThanDays, running]);

  // Listen for progress events when running
  useEffect(() => {
    if (!running) return;
    const cleanup = window.api.onBulkPriceProgress((p) => {
      setProgress((prev) => {
        const total = p.total;
        const completed = (prev?.completed ?? 0) + (p.ok ? 1 : 0);
        const failed = (prev?.failed ?? 0) + (!p.ok ? 1 : 0);
        return { total, completed, failed, done: p.index >= total };
      });
    });
    return cleanup;
  }, [running]);

  const handleStart = async () => {
    if (matched === 0) return;
    setRunning(true);
    setProgress({ total: matched ?? 0, completed: 0, failed: 0, done: false });
    try {
      const res = await window.api.applyBulkPriceRule({ percentOff, olderThanDays, dryRun: false });
      setProgress({ total: res.matched, completed: res.updated, failed: res.failed.length, done: true });
      addToast(`Updated ${res.updated} listing${res.updated === 1 ? "" : "s"}`, "success");
      onComplete();
    } catch (err) {
      addToast(`Bulk price rule failed: ${(err as Error).message}`, "error");
      setRunning(false);
    }
  };

  const pct = progress && progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && (!running || progress?.done)) onClose();
      }}
    >
      <DialogContent className="max-w-md" showCloseButton={!running || progress?.done === true}>
        <DialogHeader>
          <DialogTitle>Bulk Price Rule</DialogTitle>
          <DialogDescription>Reduce active listings older than a number of days by a percentage</DialogDescription>
        </DialogHeader>

        {!running && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Preset</Label>
              <Select value={selected} onValueChange={(v) => setSelected(v ?? CUSTOM_VALUE)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {presets.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.percentOff}% off · older than {p.olderThanDays} day{p.olderThanDays === 1 ? "" : "s"}
                    </SelectItem>
                  ))}
                  <SelectItem value={CUSTOM_VALUE}>Custom…</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-3">
              <div className="flex-1 space-y-2">
                <Label>Percent off</Label>
                <Input
                  type="number"
                  min="1"
                  max="99"
                  value={percentOff}
                  onChange={(e) => {
                    setSelected(CUSTOM_VALUE);
                    const v = parseInt(e.target.value, 10);
                    if (!Number.isNaN(v) && v > 0 && v < 100) setPercentOff(v);
                  }}
                />
              </div>
              <div className="flex-1 space-y-2">
                <Label>Older than (days)</Label>
                <Input
                  type="number"
                  min="0"
                  value={olderThanDays}
                  onChange={(e) => {
                    setSelected(CUSTOM_VALUE);
                    const v = parseInt(e.target.value, 10);
                    if (!Number.isNaN(v) && v >= 0) setOlderThanDays(v);
                  }}
                />
              </div>
            </div>

            <p className="text-sm text-muted-foreground">
              {previewing
                ? "Calculating matches…"
                : matched === null
                  ? "Could not calculate matches"
                  : `${matched} active listing${matched === 1 ? "" : "s"} match`}
            </p>
          </div>
        )}

        {running && progress && (
          <div className="space-y-3">
            <div className="w-full bg-neutral-700 rounded-full h-2 overflow-hidden">
              <div className="bg-primary h-full rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
            </div>
            <p className="text-sm text-muted-foreground">
              {progress.completed} / {progress.total} updated
              {progress.failed > 0 && <span className="text-red-400 ml-1">· {progress.failed} failed</span>}
            </p>
          </div>
        )}

        <DialogFooter>
          {!running && (
            <>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={handleStart} disabled={previewing || matched === 0 || matched === null}>
                Apply to {matched ?? 0}
              </Button>
            </>
          )}
          {running && progress?.done && <Button onClick={onClose}>Close</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
