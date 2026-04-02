import { XMarkIcon } from "@heroicons/react/20/solid";
import React, { useCallback, useEffect, useState } from "react";
import type { AppSettings, LabelPrinterSettings, PrinterInfo, RelistEntry } from "../../../shared/types";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Switch } from "../components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";

interface SettingsProps {
  addToast: (message: string, type?: "success" | "error" | "info") => void;
}

const VINTED_SITES: { value: string; label: string }[] = [
  { value: "fr", label: "Vinted.fr (France)" },
  { value: "co.uk", label: "Vinted.co.uk (UK)" },
  { value: "de", label: "Vinted.de (Germany)" },
  { value: "nl", label: "Vinted.nl (Netherlands)" },
  { value: "be", label: "Vinted.be (Belgium)" },
  { value: "es", label: "Vinted.es (Spain)" },
  { value: "it", label: "Vinted.it (Italy)" },
  { value: "pt", label: "Vinted.pt (Portugal)" },
  { value: "pl", label: "Vinted.pl (Poland)" },
  { value: "cz", label: "Vinted.cz (Czech Republic)" },
  { value: "lt", label: "Vinted.lt (Lithuania)" },
  { value: "se", label: "Vinted.se (Sweden)" },
  { value: "com", label: "Vinted.com (US)" },
];

const Settings: React.FC<SettingsProps> = ({ addToast }) => {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [relistQueue, setRelistQueue] = useState<RelistEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [paperSizes, setPaperSizes] = useState<string[]>([]);

  const loadSettings = useCallback(async () => {
    try {
      const [s, q] = await Promise.all([window.api.getSettings(), window.api.getRelistQueue()]);
      setSettings(s);
      setRelistQueue(q);
    } catch {
      addToast("Failed to load settings", "error");
    }
  }, [addToast]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // Load available printers
  useEffect(() => {
    window.api
      .getPrinters()
      .then(setPrinters)
      .catch(() => {});
  }, []);

  // Load paper sizes when a printer is selected
  useEffect(() => {
    if (!settings?.labelPrinter?.printerName) return;
    window.api
      .getPaperSizes(settings.labelPrinter.printerName)
      .then(setPaperSizes)
      .catch(() => setPaperSizes([]));
  }, [settings?.labelPrinter?.printerName]);

  const handleSave = async () => {
    if (!settings) return;

    // Validate bulk repost intervals
    if (settings.bulkRepost.minIntervalSeconds > settings.bulkRepost.maxIntervalSeconds) {
      addToast("Min interval cannot be greater than max interval", "error");
      return;
    }

    setSaving(true);
    try {
      await window.api.saveSettings(settings);
      addToast("Settings saved", "success");
    } catch {
      addToast("Failed to save settings", "error");
    } finally {
      setSaving(false);
    }
  };

  const removeRelist = async (itemId: string) => {
    try {
      await window.api.removeFromRelistQueue(itemId);
      setRelistQueue((prev) => prev.filter((r) => r.itemId !== itemId));
      addToast("Removed from relist queue", "info");
    } catch {
      addToast("Failed to remove from queue", "error");
    }
  };

  const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const updateRelisting = (key: keyof AppSettings["relisting"], value: boolean | number) => {
    setSettings((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        relisting: { ...prev.relisting, [key]: value },
      };
    });
  };

  const updateLabelPrinter = (key: keyof LabelPrinterSettings, value: string) => {
    setSettings((prev) => {
      if (!prev) return prev;
      const current = prev.labelPrinter ?? { printerName: "", paperSize: "" };
      return {
        ...prev,
        labelPrinter: { ...current, [key]: value },
      };
    });
  };

  if (!settings) {
    return <div className="text-muted-foreground text-sm py-12 text-center">Loading settings…</div>;
  }

  return (
    <div className="space-y-6 max-w-xl">
      <h2 className="text-lg font-semibold text-foreground">Settings</h2>

      {/* ─── General ─────────────────────────────────────────────────────── */}
      <Card className="p-5 space-y-4">
        <div>
          <h3 className="text-base font-medium text-foreground">General</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Application preferences</p>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm text-foreground">Dark mode</span>
            <p className="text-xs text-muted-foreground">Use dark theme throughout the app</p>
          </div>
          <Switch
            checked={settings.darkMode !== false}
            onCheckedChange={(checked) => {
              document.body.classList.toggle("dark", checked);
              updateSetting("darkMode", checked);
            }}
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm text-foreground">Minimize to tray</span>
            <p className="text-xs text-muted-foreground">Hide the app to the system tray when minimized</p>
          </div>
          <Switch checked={settings.minimizeToTray} onCheckedChange={(checked) => updateSetting("minimizeToTray", checked)} />
        </div>
      </Card>

      {/* ─── Site Selection ──────────────────────────────────────────────── */}
      <Card className="p-5 space-y-4">
        <div>
          <h3 className="text-base font-medium text-foreground">Vinted Site</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Select which Vinted marketplace to use</p>
        </div>
        <Select value={settings.site} onValueChange={(value) => updateSetting("site", value)}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select site…" />
          </SelectTrigger>
          <SelectContent>
            {VINTED_SITES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Card>

      {/* ─── Relisting ───────────────────────────────────────────────────────── */}
      <Card className="p-5 space-y-4">
        <div>
          <h3 className="text-base font-medium text-foreground">Automatic Relisting</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Automatically relist items after they sell</p>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm text-foreground">Enable relisting</span>
            <p className="text-xs text-muted-foreground">Automatically queue sold items for relisting</p>
          </div>
          <Switch checked={settings.relisting.enabled} onCheckedChange={(checked) => updateRelisting("enabled", checked)} />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm text-foreground">List as draft</span>
            <p className="text-xs text-muted-foreground">Create listings as drafts instead of publishing immediately</p>
          </div>
          <Switch checked={settings.relisting.listAsDraft} onCheckedChange={(checked) => updateRelisting("listAsDraft", checked)} />
        </div>

        <div className="space-y-1.5">
          <Label>Delay (minutes)</Label>
          <Input
            type="number"
            min="0"
            className="w-32"
            value={settings.relisting.delayMinutes}
            onChange={(e) => updateRelisting("delayMinutes", parseInt(e.target.value, 10) || 0)}
          />
          <p className="text-xs text-muted-foreground">How long to wait after a sale before relisting (0 = immediate)</p>
        </div>
      </Card>

      {/* ─── Bulk Reposting ──────────────────────────────────────────────── */}
      <Card className="p-5 space-y-4">
        <div>
          <h3 className="text-base font-medium text-foreground">Stock Management</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Control how item stock is managed when orders ship</p>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm text-foreground">Reduce stock on shipped</span>
            <p className="text-xs text-muted-foreground">
              Automatically decrease an item's stock by 1 when an order reaches the "shipped" stage
            </p>
          </div>
          <Switch checked={settings.reduceStockOnShipped} onCheckedChange={(checked) => updateSetting("reduceStockOnShipped", checked)} />
        </div>
      </Card>

      {/* ─── Shipping Labels ─────────────────────────────────────────────── */}
      <Card className="p-5 space-y-4">
        <div>
          <h3 className="text-base font-medium text-foreground">Shipping Labels</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Control how shipping labels are generated</p>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm text-foreground">Auto-generate labels</span>
            <p className="text-xs text-muted-foreground">Automatically generate shipping labels when new orders are detected</p>
          </div>
          <Switch checked={settings.autoGenerateLabels} onCheckedChange={(checked) => updateSetting("autoGenerateLabels", checked)} />
        </div>

        <div className="space-y-1.5">
          <Label>Preferred label type</Label>
          <Select
            value={settings.preferredLabelType}
            onValueChange={(value) => updateSetting("preferredLabelType", value as "printable" | "digital")}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="printable">Printable</SelectItem>
              <SelectItem value="digital">Digital</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Preferred label format when generating. Falls back to whatever the courier provides if your preference isn't available.
          </p>
        </div>
      </Card>

      {/* ─── Bulk Operations ─────────────────────────────────────────────── */}
      <Card className="p-5 space-y-4">
        <div>
          <h3 className="text-base font-medium text-foreground">Bulk Operations</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Random delay between each listing during bulk repost or publish</p>
        </div>

        <div className="flex items-center gap-4">
          <div className="space-y-1.5">
            <Label>Min interval (seconds)</Label>
            <Input
              type="number"
              min="0"
              className="w-32"
              value={settings.bulkRepost.minIntervalSeconds}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10) || 0;
                setSettings((prev) => (prev ? { ...prev, bulkRepost: { ...prev.bulkRepost, minIntervalSeconds: val } } : prev));
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Max interval (seconds)</Label>
            <Input
              type="number"
              min="0"
              className="w-32"
              value={settings.bulkRepost.maxIntervalSeconds}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10) || 0;
                setSettings((prev) => (prev ? { ...prev, bulkRepost: { ...prev.bulkRepost, maxIntervalSeconds: val } } : prev));
              }}
            />
          </div>
        </div>
      </Card>

      {/* ─── Label Printing ─────────────────────────────────────────────── */}
      <Card className="p-5 space-y-4">
        <div>
          <h3 className="text-base font-medium text-foreground">Label Printing</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Configure your shipping label printer</p>
        </div>

        <div className="space-y-1.5">
          <Label>Printer</Label>
          <Select
            value={settings.labelPrinter?.printerName || "__default__"}
            onValueChange={(value) => updateLabelPrinter("printerName", value === "__default__" ? "" : value)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="System default" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__default__">System default</SelectItem>
              {printers.map((p) => (
                <SelectItem key={p.name} value={p.name}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Select the printer used for shipping labels</p>
        </div>

        {settings.labelPrinter?.printerName && paperSizes.length > 0 && (
          <div className="space-y-1.5">
            <Label>Paper size</Label>
            <Select
              value={settings.labelPrinter?.paperSize || "__default__"}
              onValueChange={(value) => updateLabelPrinter("paperSize", value === "__default__" ? "" : value)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Printer default" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__default__">Printer default</SelectItem>
                {paperSizes.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Paper sizes are fetched from the selected printer</p>
          </div>
        )}
      </Card>

      {/* ─── Save button ─────────────────────────────────────────────────── */}
      <Button onClick={handleSave} disabled={saving} size="sm">
        {saving ? "Saving…" : "Save Settings"}
      </Button>

      {/* ─── Relist Queue ─────────────────────────────────────────────────────── */}
      {relistQueue.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium text-foreground">Relist Queue</h3>
          <div className="space-y-1">
            {relistQueue.map((entry) => (
              <Card key={entry.itemId} className="flex items-center gap-3 p-3">
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-foreground truncate block">{entry.itemTitle}</span>
                  <span className="text-xs text-muted-foreground">
                    Status: {entry.status}
                    {entry.relistAt && ` · Relist at: ${new Date(entry.relistAt).toLocaleString()}`}
                  </span>
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-red-400 hover:text-red-300"
                      onClick={() => removeRelist(entry.itemId)}
                    >
                      <XMarkIcon className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Remove</TooltipContent>
                </Tooltip>
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

export default Settings;
