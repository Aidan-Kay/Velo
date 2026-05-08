import { XMarkIcon } from "@heroicons/react/20/solid";
import { Button } from "@shared/components/ui/button";
import { Card } from "@shared/components/ui/card";
import { Input } from "@shared/components/ui/input";
import { Label } from "@shared/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@shared/components/ui/select";
import { Switch } from "@shared/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@shared/components/ui/tooltip";
import React, { useCallback, useEffect, useState } from "react";
import type { AiAssistSettings, AppSettings, LabelPrinterSettings, PriceRulePreset, PrinterInfo, RelistEntry } from "../../../shared/types";
import { useToast } from "../context/ToastContext";

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

const Settings: React.FC = () => {
  const { addToast } = useToast();
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

        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm text-foreground">Desktop notifications</span>
            <p className="text-xs text-muted-foreground">Show Windows notifications for new orders and offers</p>
          </div>
          <Switch
            checked={settings.enableNativeNotifications}
            onCheckedChange={(checked) => updateSetting("enableNativeNotifications", checked)}
          />
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

        {/* ─── Scheduled start ──────────────────────────────────────────── */}
        <div className="pt-2 border-t border-border/40 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm text-foreground">Scheduled start time</span>
              <p className="text-xs text-muted-foreground">
                Defer the next due relist until a specific time of day (HH:MM, local). Once a relist runs, the gate clears.
              </p>
            </div>
            <Switch
              checked={settings.relistScheduledStart.enabled}
              onCheckedChange={(checked) =>
                setSettings((prev) => (prev ? { ...prev, relistScheduledStart: { ...prev.relistScheduledStart, enabled: checked } } : prev))
              }
            />
          </div>

          {settings.relistScheduledStart.enabled && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Input
                  type="time"
                  className="w-32"
                  value={settings.relistScheduledStart.time ?? ""}
                  onChange={(e) =>
                    setSettings((prev) =>
                      prev ? { ...prev, relistScheduledStart: { ...prev.relistScheduledStart, time: e.target.value || null } } : prev,
                    )
                  }
                />
                <div className="flex items-center gap-1">
                  {["17:00", "18:00", "19:00", "20:00"].map((t) => {
                    const label = `${parseInt(t.split(":")[0], 10) - 12} PM`;
                    return (
                      <Button
                        key={t}
                        type="button"
                        size="sm"
                        variant={settings.relistScheduledStart.time === t ? "default" : "outline"}
                        onClick={() =>
                          setSettings((prev) =>
                            prev ? { ...prev, relistScheduledStart: { ...prev.relistScheduledStart, time: t } } : prev,
                          )
                        }
                      >
                        {label}
                      </Button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
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

      {/* ─── Polling Intervals ───────────────────────────────────────────── */}
      <Card className="p-5 space-y-4">
        <div>
          <h3 className="text-base font-medium text-foreground">Polling Intervals</h3>
          <p className="text-xs text-muted-foreground mt-0.5">How often each resource is checked for updates (in minutes)</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {(
            [
              ["ordersMinutes", "Orders"],
              ["listingsMinutes", "Listings"],
              ["purchasesMinutes", "Purchases"],
              ["offersMinutes", "Offers"],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="space-y-1.5">
              <Label>{label}</Label>
              <Input
                type="number"
                min="1"
                className="w-32"
                value={settings.pollingIntervals[key]}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!Number.isNaN(val) && val >= 1) {
                    setSettings((prev) => (prev ? { ...prev, pollingIntervals: { ...prev.pollingIntervals, [key]: val } } : prev));
                  }
                }}
              />
            </div>
          ))}
        </div>
      </Card>

      {/* ─── Auto-Accept Offers ──────────────────────────────────────────── */}
      <Card className="p-5 space-y-4">
        <div>
          <h3 className="text-base font-medium text-foreground">Auto-Accept Offers</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Automatically accept buyer offers that meet or exceed a percentage of the listing price
          </p>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm text-foreground">Enable auto-accept</span>
            <p className="text-xs text-muted-foreground">
              {settings.autoAcceptOfferPercent !== null
                ? `Offers at or above ${settings.autoAcceptOfferPercent}% of the listing price will be auto-accepted`
                : "Disabled — no offers will be auto-accepted"}
            </p>
          </div>
          <Switch
            checked={settings.autoAcceptOfferPercent !== null}
            onCheckedChange={(checked) => updateSetting("autoAcceptOfferPercent", checked ? 90 : null)}
          />
        </div>

        {settings.autoAcceptOfferPercent !== null && (
          <div className="space-y-1.5">
            <Label>Minimum percentage (%)</Label>
            <Input
              type="number"
              min="1"
              max="100"
              className="w-32"
              value={settings.autoAcceptOfferPercent}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                if (!Number.isNaN(val) && val >= 1 && val <= 100) {
                  updateSetting("autoAcceptOfferPercent", val);
                }
              }}
            />
            <p className="text-xs text-muted-foreground">Per-item overrides can be set in each item's edit form</p>
          </div>
        )}
      </Card>

      {/* ─── Auto-Ignore Offers ──────────────────────────────────────────── */}
      <Card className="p-5 space-y-4">
        <div>
          <h3 className="text-base font-medium text-foreground">Auto-Ignore Offers</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Automatically mark buyer offers below a percentage of the listing price as ignored
          </p>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm text-foreground">Enable auto-ignore</span>
            <p className="text-xs text-muted-foreground">
              {settings.autoIgnoreOfferPercent !== null
                ? `Offers below ${settings.autoIgnoreOfferPercent}% of the listing price will be auto-ignored`
                : "Disabled — no offers will be auto-ignored"}
            </p>
          </div>
          <Switch
            checked={settings.autoIgnoreOfferPercent !== null}
            onCheckedChange={(checked) => updateSetting("autoIgnoreOfferPercent", checked ? 50 : null)}
          />
        </div>

        {settings.autoIgnoreOfferPercent !== null && (
          <div className="space-y-1.5">
            <Label>Maximum percentage (%)</Label>
            <Input
              type="number"
              min="1"
              max="100"
              className="w-32"
              value={settings.autoIgnoreOfferPercent}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                if (!Number.isNaN(val) && val >= 1 && val <= 100) {
                  updateSetting("autoIgnoreOfferPercent", val);
                }
              }}
            />
          </div>
        )}
      </Card>

      {/* ─── Price Rule Presets ──────────────────────────────────────────── */}
      <Card className="p-5 space-y-4">
        <div>
          <h3 className="text-base font-medium text-foreground">Price Rule Presets</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Quick presets for the bulk price rule on the Listings page</p>
        </div>

        <div className="space-y-2">
          {settings.priceRulePresets.map((preset, idx) => (
            <div key={preset.id} className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <Input
                  type="number"
                  min="1"
                  max="99"
                  className="w-20"
                  value={preset.percentOff}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (!Number.isNaN(v) && v > 0 && v < 100) {
                      setSettings((prev) => {
                        if (!prev) return prev;
                        const next = [...prev.priceRulePresets];
                        next[idx] = { ...next[idx], percentOff: v };
                        return { ...prev, priceRulePresets: next };
                      });
                    }
                  }}
                />
                <span className="text-xs text-muted-foreground">% off</span>
              </div>
              <span className="text-xs text-muted-foreground">·</span>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">older than</span>
                <Input
                  type="number"
                  min="0"
                  className="w-20"
                  value={preset.olderThanDays}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (!Number.isNaN(v) && v >= 0) {
                      setSettings((prev) => {
                        if (!prev) return prev;
                        const next = [...prev.priceRulePresets];
                        next[idx] = { ...next[idx], olderThanDays: v };
                        return { ...prev, priceRulePresets: next };
                      });
                    }
                  }}
                />
                <span className="text-xs text-muted-foreground">days</span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto text-red-400 hover:text-red-300"
                onClick={() =>
                  setSettings((prev) => (prev ? { ...prev, priceRulePresets: prev.priceRulePresets.filter((_, i) => i !== idx) } : prev))
                }
              >
                <XMarkIcon className="w-4 h-4" />
              </Button>
            </div>
          ))}

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const newPreset: PriceRulePreset = {
                id: `preset-${Date.now()}`,
                percentOff: 5,
                olderThanDays: 7,
              };
              setSettings((prev) => (prev ? { ...prev, priceRulePresets: [...prev.priceRulePresets, newPreset] } : prev));
            }}
          >
            Add preset
          </Button>
        </div>
      </Card>

      {/* ─── AI Assist ──────────────────────────────────────────────────── */}
      <Card className="p-5 space-y-4">
        <div>
          <h3 className="text-base font-medium text-foreground">AI Assist</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Generate listing titles and descriptions from photos. Up to 3 photos are sent per request.
          </p>
        </div>

        <div className="space-y-2">
          <Label>Provider</Label>
          <div className="flex gap-2">
            {(["openai", "ollama", "llamacpp"] as const).map((provider) => (
              <Button
                key={provider}
                type="button"
                size="sm"
                variant={settings.aiAssist.provider === provider ? "default" : "outline"}
                onClick={() =>
                  setSettings((prev) => (prev ? { ...prev, aiAssist: { ...prev.aiAssist, provider } as AiAssistSettings } : prev))
                }
              >
                {provider === "openai" ? "OpenAI" : provider === "ollama" ? "Ollama" : "llama.cpp"}
              </Button>
            ))}
          </div>
        </div>

        {settings.aiAssist.provider === "openai" && (
          <>
            <div className="space-y-1.5">
              <Label>OpenAI API key</Label>
              <Input
                type="password"
                placeholder="sk-…"
                value={settings.aiAssist.openaiApiKey ?? ""}
                onChange={(e) =>
                  setSettings((prev) => (prev ? { ...prev, aiAssist: { ...prev.aiAssist, openaiApiKey: e.target.value } } : prev))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Model</Label>
              <Input
                placeholder="gpt-4o-mini"
                value={settings.aiAssist.openaiModel ?? ""}
                onChange={(e) =>
                  setSettings((prev) => (prev ? { ...prev, aiAssist: { ...prev.aiAssist, openaiModel: e.target.value } } : prev))
                }
              />
            </div>
          </>
        )}

        {settings.aiAssist.provider === "ollama" && (
          <>
            <div className="space-y-1.5">
              <Label>Endpoint</Label>
              <Input
                placeholder="http://localhost:11434"
                value={settings.aiAssist.ollamaEndpoint ?? ""}
                onChange={(e) =>
                  setSettings((prev) => (prev ? { ...prev, aiAssist: { ...prev.aiAssist, ollamaEndpoint: e.target.value } } : prev))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Model</Label>
              <Input
                placeholder="llama3.2-vision"
                value={settings.aiAssist.ollamaModel ?? ""}
                onChange={(e) =>
                  setSettings((prev) => (prev ? { ...prev, aiAssist: { ...prev.aiAssist, ollamaModel: e.target.value } } : prev))
                }
              />
            </div>
          </>
        )}

        {settings.aiAssist.provider === "llamacpp" && (
          <>
            <div className="space-y-1.5">
              <Label>Endpoint</Label>
              <Input
                placeholder="http://localhost:8080"
                value={settings.aiAssist.llamacppEndpoint ?? ""}
                onChange={(e) =>
                  setSettings((prev) => (prev ? { ...prev, aiAssist: { ...prev.aiAssist, llamacppEndpoint: e.target.value } } : prev))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Model</Label>
              <Input
                placeholder="default"
                value={settings.aiAssist.llamacppModel ?? ""}
                onChange={(e) =>
                  setSettings((prev) => (prev ? { ...prev, aiAssist: { ...prev.aiAssist, llamacppModel: e.target.value } } : prev))
                }
              />
            </div>
          </>
        )}

        <div className="space-y-1.5">
          <Label>System prompt</Label>
          <textarea
            className="w-full h-24 rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
            value={settings.aiAssist.systemPrompt ?? ""}
            onChange={(e) =>
              setSettings((prev) => (prev ? { ...prev, aiAssist: { ...prev.aiAssist, systemPrompt: e.target.value } } : prev))
            }
          />
        </div>
      </Card>

      {/* ─── Save button ─────────────────────────────────────────────────── */}
      <Button onClick={handleSave} disabled={saving}>
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
                  <TooltipTrigger>
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

export default React.memo(Settings);
