import { titleKey } from "../shared/lib/match";
import type { AppSettings, LocalItem, Order } from "../shared/types";
import { saveItems } from "./persistence";
import { getDomain } from "./shared/constants";
import * as vintedApi from "./vinted/api";

/** Reduce stock for local items matching orders that have reached the "shipped" stage. */
export function reduceStockForShippedOrders(orders: Order[], cachedOrders: Order[], settings: AppSettings, items: LocalItem[]): boolean {
  if (!settings.reduceStockOnShipped) return false;

  const cachedMap = new Map<number, Order>();
  for (const cached of cachedOrders) {
    if (cached.transactionId) cachedMap.set(cached.transactionId, cached);
  }

  let changed = false;
  for (const order of orders) {
    if (order.orderStatus !== "shipped") continue;
    if (order.stockReduced) continue;

    const cached = order.transactionId ? cachedMap.get(order.transactionId) : null;
    if (cached?.stockReduced) {
      order.stockReduced = true;
      continue;
    }
    if (cached && cached.orderStatus === "shipped") continue;

    const titlesToReduce: string[] = [];
    if (order.isBundle && order.bundleItems.length > 0) {
      titlesToReduce.push(...order.bundleItems.map((b) => b.title));
    } else {
      titlesToReduce.push(order.itemTitle);
    }

    for (const title of titlesToReduce) {
      const key = titleKey(title);
      const item = items.find((i) => titleKey(i.title) === key);
      if (item && item.stock > 0) {
        item.stock -= 1;
        changed = true;
        console.log(`[stock] Reduced stock for "${item.title}" to ${item.stock} (order ${order.transactionId} shipped)`);
      }
    }

    order.stockReduced = true;
  }
  if (changed) {
    saveItems(items);
  }
  return changed;
}

/** Automatically generate shipping labels for new orders that don't have one. */
export async function autoGenerateLabelsForNewOrders(orders: Order[], cachedOrders: Order[], settings: AppSettings): Promise<void> {
  if (!settings.autoGenerateLabels) return;

  try {
    const domain = getDomain(settings.site);
    const cachedIds = new Set(cachedOrders.map((o) => o.transactionId).filter(Boolean));

    for (const order of orders) {
      if (!order.transactionId) continue;
      if (cachedIds.has(order.transactionId)) continue;
      if (order.shipmentStatus != null && order.shipmentStatus !== 1) continue;

      try {
        console.log(`[auto-label] Generating label for new order ${order.transactionId}...`);

        const addressResult = await vintedApi.getDefaultShippingAddress(domain);
        const sellerAddressId = addressResult.user_address?.id;
        if (!sellerAddressId) {
          console.warn("[auto-label] No default shipping address — skipping");
          continue;
        }

        let labelType = settings.preferredLabelType || "printable";
        if (order.shipmentId) {
          try {
            const labelOpts = await vintedApi.getShipmentLabelOptions(order.shipmentId, domain);
            if (labelOpts.label_types.length > 0 && !labelOpts.label_types.includes(labelType)) {
              labelType = labelOpts.label_types[0] as "printable" | "digital";
              console.log(`[auto-label] Preferred type not available, using "${labelType}"`);
            }
          } catch {
            // Fall through with preferred type
          }
        }

        await vintedApi.orderShippingLabel(order.transactionId, sellerAddressId, labelType, domain);
        console.log(`[auto-label] Label generated for order ${order.transactionId}`);
      } catch (err) {
        console.error(`[auto-label] Failed for order ${order.transactionId}:`, (err as Error).message);
      }
    }
  } catch (err) {
    console.error("[auto-label] Unexpected error in autoGenerateLabelsForNewOrders:", (err as Error).message);
  }
}
