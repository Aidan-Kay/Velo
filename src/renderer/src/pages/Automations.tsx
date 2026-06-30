import { PlusIcon, XMarkIcon } from "@heroicons/react/20/solid";
import { Button } from "@shared/components/ui/button";
import { Card } from "@shared/components/ui/card";
import { Input } from "@shared/components/ui/input";
import { Label } from "@shared/components/ui/label";
import { Switch } from "@shared/components/ui/switch";
import React, { useCallback, useEffect, useState } from "react";
import type { AppSettings, OfferAutomationRule } from "../../../shared/types";
import { useToast } from "../context/ToastContext";

const createRule = (): OfferAutomationRule => ({
  id: `offer-rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  tag: "",
  itemCount: 2,
  minimumOfferAmount: 0,
});

const compareOfferRules = (left: OfferAutomationRule, right: OfferAutomationRule): number => {
  const tagCompare = left.tag.trim().localeCompare(right.tag.trim(), undefined, { sensitivity: "base" });
  if (tagCompare !== 0) return tagCompare;
  return left.itemCount - right.itemCount;
};

const Automations: React.FC = () => {
  const { addToast } = useToast();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);

  const loadSettings = useCallback(async () => {
    try {
      const nextSettings = await window.api.getSettings();
      setSettings(nextSettings);
    } catch {
      addToast("Failed to load automations", "error");
    }
  }, [addToast]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const updateRule = (ruleId: string, patch: Partial<OfferAutomationRule>) => {
    setSettings((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        offerAutomationRules: prev.offerAutomationRules.map((rule) => (rule.id === ruleId ? { ...rule, ...patch } : rule)),
      };
    });
  };

  const addRule = () => {
    setSettings((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        offerAutomationRules: [...prev.offerAutomationRules, createRule()],
      };
    });
  };

  const removeRule = (ruleId: string) => {
    setSettings((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        offerAutomationRules: prev.offerAutomationRules.filter((rule) => rule.id !== ruleId),
      };
    });
  };

  const handleSave = async () => {
    if (!settings) return;

    const sanitizedRules = settings.offerAutomationRules
      .map((rule) => ({
        ...rule,
        tag: rule.tag.trim(),
        itemCount: Math.trunc(rule.itemCount),
      }))
      .sort(compareOfferRules);

    if (sanitizedRules.some((rule) => !rule.tag || rule.itemCount < 1 || rule.minimumOfferAmount < 0)) {
      addToast("Each rule needs a tag, an item count of at least 1, and a non-negative minimum amount", "error");
      return;
    }

    setSaving(true);
    try {
      await window.api.saveSettings({
        ...settings,
        offerAutomationRules: sanitizedRules,
      });
      setSettings((prev) => (prev ? { ...prev, offerAutomationRules: sanitizedRules } : prev));
      addToast("Automations saved", "success");
    } catch {
      addToast("Failed to save automations", "error");
    } finally {
      setSaving(false);
    }
  };

  if (!settings) {
    return <div className="text-muted-foreground text-sm py-12 text-center">Loading automations…</div>;
  }

  const sortedRules = [...settings.offerAutomationRules].sort(compareOfferRules);

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-foreground">Automations</h2>
        <p className="text-sm text-muted-foreground">
          Configure how incoming offers are auto-accepted, auto-ignored, and matched against your custom bundle rules.
        </p>
      </div>

      <Card className="p-5 space-y-4">
        <div>
          <div>
            <h3 className="text-base font-medium text-foreground">Offers</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Custom rules are evaluated during offer polling before percentage-based auto-accept.
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-border/70 p-4 space-y-4">
          <div>
            <h4 className="text-sm font-medium text-foreground">Auto-Accept</h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              Automatically accept buyer offers that meet or exceed a percentage of the listing price.
            </p>
          </div>

          <div className="flex items-center justify-between gap-4">
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
              onCheckedChange={(checked) => {
                setSettings((prev) => (prev ? { ...prev, autoAcceptOfferPercent: checked ? 90 : null } : prev));
              }}
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
                  const value = parseInt(e.target.value, 10);
                  if (!Number.isNaN(value) && value >= 1 && value <= 100) {
                    setSettings((prev) => (prev ? { ...prev, autoAcceptOfferPercent: value } : prev));
                  }
                }}
              />
              <p className="text-xs text-muted-foreground">Per-item overrides can still be set in each item's edit form.</p>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-border/70 p-4 space-y-4">
          <div>
            <h4 className="text-sm font-medium text-foreground">Auto-Ignore</h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              Automatically mark buyer offers below a percentage of the listing price as ignored.
            </p>
          </div>

          <div className="flex items-center justify-between gap-4">
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
              onCheckedChange={(checked) => {
                setSettings((prev) => (prev ? { ...prev, autoIgnoreOfferPercent: checked ? 50 : null } : prev));
              }}
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
                  const value = parseInt(e.target.value, 10);
                  if (!Number.isNaN(value) && value >= 1 && value <= 100) {
                    setSettings((prev) => (prev ? { ...prev, autoIgnoreOfferPercent: value } : prev));
                  }
                }}
              />
            </div>
          )}
        </div>

        <div className="rounded-lg border border-border/70 p-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-medium text-foreground">Custom Rules</h4>
              <p className="text-xs text-muted-foreground mt-0.5">
                Auto-accept bundle offers when every offered item matches a saved item title, every matched item carries the configured tag,
                the bundle size is exact, and the total offer amount meets your minimum.
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={addRule}>
              <PlusIcon className="w-4 h-4 mr-1.5" />
              Add rule
            </Button>
          </div>

          {sortedRules.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/70 px-4 py-6 text-sm text-muted-foreground">
              No automation rules yet.
            </div>
          ) : (
            <div className="space-y-3">
              {sortedRules.map((rule) => (
                <div key={rule.id} className="rounded-lg border border-border/70 p-4 space-y-4">
                  <div className="grid gap-4 md:grid-cols-[repeat(3,minmax(0,1fr))_auto]">
                    <div className="space-y-1.5">
                      <Label>Tag</Label>
                      <Input value={rule.tag} onChange={(e) => updateRule(rule.id, { tag: e.target.value })} placeholder="bundle" />
                    </div>

                    <div className="space-y-1.5">
                      <Label>Item count</Label>
                      <Input
                        type="number"
                        min="1"
                        step="1"
                        value={rule.itemCount}
                        onChange={(e) => updateRule(rule.id, { itemCount: parseInt(e.target.value, 10) || 0 })}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label>Minimum offer amount</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={rule.minimumOfferAmount}
                        onChange={(e) => updateRule(rule.id, { minimumOfferAmount: parseFloat(e.target.value) || 0 })}
                      />
                    </div>
                    <div className="flex items-center md:self-center">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-red-400 hover:text-red-300"
                        onClick={() => removeRule(rule.id)}
                      >
                        <XMarkIcon className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save Automations"}
        </Button>
        <span className="text-xs text-muted-foreground">These rules use your existing saved items and tags.</span>
      </div>
    </div>
  );
};

export default React.memo(Automations);
