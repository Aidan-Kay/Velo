import { Button } from "@shared/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@shared/components/ui/dialog";
import { Input } from "@shared/components/ui/input";
import { Label } from "@shared/components/ui/label";
import React, { useCallback, useEffect, useState } from "react";
import type { ReceivedOffer, SellerOfferOptions } from "../../../shared/types";

const CURRENCY_SYMBOLS: Record<string, string> = { GBP: "£", EUR: "€", USD: "$", PLN: "zł" };
function formatCurrency(code: string): string {
  return CURRENCY_SYMBOLS[code] || code + " ";
}

interface CounterOfferModalProps {
  offer: ReceivedOffer | null;
  open: boolean;
  onClose: () => void;
  onSubmit: (transactionId: number, price: number, currency: string) => Promise<void>;
}

const CounterOfferModal: React.FC<CounterOfferModalProps> = ({ offer, open, onClose, onSubmit }) => {
  const [price, setPrice] = useState("");
  const [options, setOptions] = useState<SellerOfferOptions | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch seller offer options when modal opens
  useEffect(() => {
    if (!open || !offer) return;
    setLoading(true);
    setOptions(null);
    setError(null);
    setPrice("");

    window.api
      .getSellerOfferOptions(offer.transactionId)
      .then((opts) => {
        setOptions(opts);
        // Pre-fill with current offer price
        setPrice(offer.offerPrice.amount);
      })
      .catch(() => {
        // If options fail, still allow counter-offer with offer price pre-filled
        setPrice(offer.offerPrice.amount);
      })
      .finally(() => setLoading(false));
  }, [open, offer]);

  const handleSubmit = useCallback(async () => {
    if (!offer || !price) return;

    const numPrice = parseFloat(price);
    if (isNaN(numPrice) || numPrice <= 0) {
      setError("Please enter a valid price");
      return;
    }

    if (options) {
      if (options.minPrice != null && numPrice < options.minPrice) {
        setError(`Minimum price is ${options.minPrice}`);
        return;
      }
      if (options.maxPrice != null && numPrice > options.maxPrice) {
        setError(`Maximum price is ${options.maxPrice}`);
        return;
      }
    }

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(offer.transactionId, numPrice, offer.offerPrice.currencyCode);
      onClose();
    } catch (err) {
      setError((err as Error).message || "Failed to send counter-offer");
    } finally {
      setSubmitting(false);
    }
  }, [offer, price, options, onSubmit, onClose]);

  const currencySymbol = offer ? formatCurrency(offer.offerPrice.currencyCode) : "";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Counter Offer</DialogTitle>
        </DialogHeader>

        {offer && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              {offer.itemThumbnail && <img src={offer.itemThumbnail} alt="" className="w-12 h-12 rounded object-cover" />}
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{offer.itemTitle}</p>
                <p className="text-xs text-muted-foreground">
                  Buyer: {offer.buyerUsername} · Original: {offer.originalPriceLabel} · Offer: {offer.offerPriceLabel}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="counter-price">Your counter price ({currencySymbol})</Label>
              <Input
                id="counter-price"
                type="number"
                step="0.01"
                min={options?.minPrice ?? 0}
                max={options?.maxPrice ?? undefined}
                value={price}
                onChange={(e) => {
                  setPrice(e.target.value);
                  setError(null);
                }}
                placeholder={loading ? "Loading..." : "Enter price"}
                disabled={loading || submitting}
              />
              {options && (
                <p className="text-xs text-muted-foreground">
                  {options.minPrice != null && `Min: ${currencySymbol}${options.minPrice.toFixed(2)}`}
                  {options.minPrice != null && options.maxPrice != null && " · "}
                  {options.maxPrice != null && `Max: ${currencySymbol}${options.maxPrice.toFixed(2)}`}
                </p>
              )}
              {error && <p className="text-xs text-destructive">{error}</p>}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading || submitting || !price}>
            {submitting ? "Sending..." : "Send Counter Offer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CounterOfferModal;
