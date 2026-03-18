import type { JourneySummaryResult } from "../../shared/types";
import { DEFAULT_DOMAIN } from "../shared/constants";
import { getClient } from "./lib/requester";

const VINTED_API = "/api/v2";

// ─── Shipping ───────────────────────────────────────────────────────────────

export async function getShippingInstructions(transactionId: number, domain?: string): Promise<unknown> {
  const client = getClient(domain || DEFAULT_DOMAIN);
  const apiUrl = `https://${client.domain}${VINTED_API}/transactions/${transactionId}/shipping_instructions`;

  console.log(`[vinted] Fetching shipping instructions for ${transactionId}...`);
  const response = await client.get(apiUrl);

  if (response.status !== 200) {
    throw new Error(`Failed to fetch shipping instructions (status ${response.status})`);
  }
  return response.data;
}

export async function getDefaultShippingAddress(domain?: string): Promise<{ user_address?: { id?: number } }> {
  const client = getClient(domain || DEFAULT_DOMAIN);
  const apiUrl = `https://${client.domain}${VINTED_API}/user_addresses/default_shipping_address`;

  const response = await client.get<{ user_address?: { id?: number } }>(apiUrl);
  if (response.status !== 200) {
    throw new Error(`Failed to fetch default shipping address (status ${response.status})`);
  }
  return response.data ?? {};
}

export async function orderShippingLabel(
  transactionId: number,
  sellerAddressId: number,
  labelType: string = "printable",
  domain?: string,
): Promise<unknown> {
  const client = getClient(domain || DEFAULT_DOMAIN);
  const apiUrl = `https://${client.domain}${VINTED_API}/transactions/${transactionId}/shipment/order`;

  console.log(`[vinted] Ordering shipping label for transaction ${transactionId}...`);
  const payload = { label_type: labelType, drop_off_type: null, seller_address_id: sellerAddressId };
  console.log(`[vinted] Shipping label order payload: ${JSON.stringify(payload)}`);
  const response = await client.put(apiUrl, payload, { locale: "en-GB" });

  if (response.status !== 200) {
    throw new Error(`Failed to order shipping label (status ${response.status})`);
  }
  return response.data;
}

export async function getShippingLabelUrl(shipmentId: number, domain?: string): Promise<{ label_url: string }> {
  const client = getClient(domain || DEFAULT_DOMAIN);
  const apiUrl = `https://${client.domain}${VINTED_API}/shipments/${shipmentId}/label_url`;

  console.log(`[vinted] Fetching shipping label URL for shipment ${shipmentId}...`);
  const response = await client.get<{ label_url?: string }>(apiUrl);

  if (response.status !== 200) {
    throw new Error(`Failed to fetch shipping label URL (status ${response.status})`);
  }
  return { label_url: response.data?.label_url || "" };
}

// ─── Journey Summary (Tracking) ────────────────────────────────────────────

interface RawJourneyCarrier {
  code?: string;
  tracking_url?: string;
  tracking_code?: string;
  logo_url?: string;
  is_current?: boolean;
}

interface RawJourneySummary {
  journey_summary?: {
    current_carrier?: RawJourneyCarrier;
    estimated_detail?: {
      time_period?: string;
      status?: string;
      message?: string | null;
    };
    status?: string;
  };
}

export async function getJourneySummary(transactionId: number, domain?: string): Promise<JourneySummaryResult> {
  const client = getClient(domain || DEFAULT_DOMAIN);
  const apiUrl = `https://${client.domain}${VINTED_API}/transactions/${transactionId}/shipment/journey_summary`;

  console.log(`[vinted] Fetching journey summary for transaction ${transactionId}...`);
  const response = await client.get<RawJourneySummary>(apiUrl);

  if (response.status !== 200) {
    throw new Error(`Failed to fetch journey summary (status ${response.status})`);
  }

  const summary = response.data?.journey_summary;
  const carrier = summary?.current_carrier;

  return {
    trackingCode: carrier?.tracking_code || null,
    trackingUrl: carrier?.tracking_url || null,
    carrierLogoUrl: carrier?.logo_url || null,
    carrierCode: carrier?.code || null,
    estimatedDelivery: summary?.estimated_detail?.time_period || null,
    status: summary?.status || null,
  };
}
