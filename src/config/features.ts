/**
 * SB Floristry - Feature Flags
 * 
 * Central feature configuration for toggling commerce and legacy retail channels.
 * Keep underlying code intact for future premium relaunches (e.g., 'Editions').
 */

export const features = {
  // Enables Shopify catalog, product cards, collections, and cart UI
  shop: false,

  // Enables GoCardless recurring subscription plans & checkout
  subscriptions: false,

  // Enables legacy Gift Picker / AI Advisor quiz
  giftPicker: false,

  // Enables delivery postcode checker bar and modal
  deliveryChecker: false,
};
