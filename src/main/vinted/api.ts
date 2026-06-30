/**
 * Vinted API -- barrel re-export.
 *
 * All domain logic now lives in focused sub-modules:
 *   auth.ts      -- login / session management
 *   listings.ts  -- listing CRUD, photo upload, item_upload detail
 *   orders.ts    -- order fetching, transaction / conversation detail
 *   shipping.ts  -- shipping instructions, label ordering, journey tracking
 *   catalog.ts   -- categories, attributes, conditions, package sizes
 *   mappers.ts   -- raw-to-domain type mappers (shared by listings & orders)
 */

export { checkSession, getLoginStatus, login, logout } from "./auth";
export { getCategories, getCategoryAttributes, getConditions, getPackageSizes } from "./catalog";
export { resetClientWindow } from "./lib/requester";
export {
  createListing,
  deleteListing,
  editListingPrice,
  getItemUploadDetail,
  getListingAsVintedListing,
  getListingDetails,
  getMyListings,
  publishListing,
} from "./listings";
export { getInbox, sendMessage } from "./messaging";
export { acceptOffer, counterOffer, getReceivedOffers, getSellerOfferOptions } from "./offers";
export { getConversation as getConversationDetail, getConversation, getMyOrders, getMyPurchases, getTransactionDetail } from "./orders";
export {
  getDefaultShippingAddress,
  getJourneySummary,
  getShipmentLabelOptions,
  getShippingInstructions,
  getShippingLabelUrl,
  orderShippingLabel,
} from "./shipping";
