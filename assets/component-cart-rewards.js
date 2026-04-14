import { Component } from '@theme/component';
import { fetchConfig } from '@theme/utilities';
import { ThemeEvents, CartAddEvent, CartUpdateEvent } from '@theme/events';
import { formatMoney } from '@theme/money-formatting';

/**
 * @typedef {{ variant_id: number, final_line_price: number, line: number }} CartItem
 * @typedef {{ total_price: number, items: CartItem[] }} Cart
 */

/**
 * CartRewardsComponent
 *
 * Manages cart threshold rewards: evaluates thresholds on cart changes,
 * auto-adds/removes free products, and updates the progress bar UI.
 *
 * Configuration is passed via data-* attributes set by cart-rewards-bar.liquid:
 * - data-thresholds: JSON array of threshold objects (amounts in cents)
 * - data-max-threshold: Maximum threshold amount in cents (sets bar scale)
 * - data-cart-total: Initial cart total in cents (for SSR-hydration continuity)
 *
 * @typedef {{ progressFill: HTMLElement, progressMessage: HTMLElement }} Refs
 * @extends {Component<Refs>}
 */
class CartRewardsComponent extends Component {
  /** @type {boolean} Prevents event loop when auto-adding/removing gift products */
  #isProcessing = false;

  /** @type {Array<{amount: number, type: string, variant_id: string, label: string, position: number}>} */
  #thresholds = [];

  /** @type {number} Maximum threshold amount in cents */
  #maxThreshold = 0;

  /** @type {string} Shopify money format string (e.g. '${{amount}}') */
  #moneyFormat = '${{amount}}';

  /** @type {string} ISO 4217 currency code */
  #currency = 'USD';

  connectedCallback() {
    super.connectedCallback();

    try {
      this.#thresholds = JSON.parse(this.dataset.thresholds || '[]');
    } catch {
      this.#thresholds = [];
    }
    this.#maxThreshold = parseInt(this.dataset.maxThreshold || '0', 10);
    this.#moneyFormat = this.dataset.moneyFormat || '${{amount}}';
    this.#currency = this.dataset.currency || 'USD';

    document.addEventListener(ThemeEvents.cartUpdate, this.#handleCartChange);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener(ThemeEvents.cartUpdate, this.#handleCartChange);
  }

  /**
   * Handles any cart:update event (covers both CartAddEvent and CartUpdateEvent).
   * @param {Event} event
   */
  #handleCartChange = async (event) => {
    if (this.#isProcessing) return;

    const totalPrice = event.detail?.resource?.total_price;
    if (totalPrice == null) return;

    // Give immediate visual feedback using the event total before any awaits.
    // #evaluateThresholds re-derives the correct userSubtotal from a fresh cart fetch.
    this.#updateProgressBar(totalPrice);
    await this.#evaluateThresholds(totalPrice);
  };

  /**
   * Evaluates all thresholds and triggers auto-add/remove for free_product rewards.
   *
   * The threshold comparison uses the cart's real subtotal with all gift items subtracted.
   * Using the raw event total_price is unreliable: it includes any gift product's catalog
   * price (even if discounted to $0 via line item discount) and causes thresholds to appear
   * met when the user's actual spend has already dropped below them.
   *
   * Cart is re-fetched before each mutation so line numbers are always current.
   * @param {number} _totalPrice - Raw cart total from the event (not used for threshold checks).
   */
  async #evaluateThresholds(_totalPrice) {
    /** All gift variant IDs across every threshold, used to exclude them from the subtotal. */
    const giftVariantIds = this.#thresholds
      .filter((t) => t.type === 'free_product' && t.variant_id)
      .map((t) => parseInt(t.variant_id, 10))
      .filter(Boolean);

    if (!giftVariantIds.length) return;

    for (const threshold of this.#thresholds) {
      if (threshold.type !== 'free_product' || !threshold.variant_id) continue;

      const variantId = parseInt(threshold.variant_id, 10);
      if (!variantId) continue;

      const cart = await this.#fetchCart();
      if (!cart) continue;

      const giftItem = cart.items?.find((item) => item.variant_id === variantId);
      const isGiftInCart = Boolean(giftItem);

      console.log({ cart, giftItem, isGiftInCart });

      // Subtract gift items from cart.total_price so their catalog price never
      // inflates the apparent subtotal and triggers a false "threshold met" result.
      const giftTotal = (cart.items ?? []).reduce(
        (sum, item) => (giftVariantIds.includes(item.variant_id) ? sum + item.final_line_price : sum),
        0
      );
      const userSubtotal = cart.total_price - giftTotal;
      const isUnlocked = userSubtotal >= threshold.amount;

      if (isUnlocked && !isGiftInCart) {
        await this.#addGiftProduct(variantId);
      } else if (!isUnlocked && isGiftInCart) {
        await this.#removeGiftProduct(giftItem.variant_id);
      }
    }
  }

  /**
   * Fetches the current cart state from the Storefront API.
   * @returns {Promise<Cart|null>}
   */
  async #fetchCart() {
    try {
      const response = await fetch(`${window.location.origin}/cart.js`);
      return /** @type {Cart} */ (await response.json());
    } catch {
      return null;
    }
  }

  /**
   * Returns the section IDs of every cart-items-component on the page.
   * Used to request section re-renders after gift product mutations in the drawer.
   * @returns {string[]}
   */
  #getCartSectionIds() {
    const ids = [];
    for (const el of document.querySelectorAll('cart-items-component')) {
      if (el instanceof HTMLElement && el.dataset.sectionId) {
        ids.push(el.dataset.sectionId);
      }
    }
    return ids;
  }

  /**
   * Auto-adds the gift product variant to the cart and triggers a section re-render.
   * Includes section IDs in the request so Shopify returns fresh HTML; dispatches
   * CartAddEvent so CartItemsComponent can call morphSection in both drawer and page contexts.
   * Without the dispatch, the DOM remains stale after the gift is injected.
   * @param {number} variantId
   */
  async #addGiftProduct(variantId) {
    this.#isProcessing = true;
    try {
      const sectionIds = this.#getCartSectionIds();
      const payload = {
        items: [{ id: variantId, quantity: 1 }],
        ...(sectionIds.length && { sections: sectionIds.join(',') }),
      };

      const response = await fetch(Theme.routes.cart_add_url, fetchConfig('json', { body: JSON.stringify(payload) }));
      const data = await response.json();

      // Always dispatch so CartItemsComponent re-renders:
      // - with sections → morphSection (efficient patch)
      // - without sections → sectionRenderer.renderSection fallback (fresh fetch)
      document.dispatchEvent(new CartAddEvent(data, 'cart-rewards-component', { sections: data.sections ?? {} }));
    } finally {
      this.#isProcessing = false;
    }
  }

  /**
   * Removes the gift product from the cart by its 1-based line number and triggers a section re-render.
   * Critical: without the dispatch the gift remains visible in the DOM even after the server removes it,
   * because CartItemsComponent already morphed with HTML that still contained the gift.
   * @param {number} variantId - The variant ID of the gift product to remove.
   */
  async #removeGiftProduct(variantId) {
    this.#isProcessing = true;
    try {
      const sectionIds = this.#getCartSectionIds();
      const payload = {
        'id': variantId,
        'quantity': 0,
        sections_url: window.location.pathname,
        ...(sectionIds.length && { sections: sectionIds.join(',') }),
      };
      console.log({payload})

      const response = await fetch(Theme.routes.cart_change_url, fetchConfig('json', { body: JSON.stringify(payload) }));
      const data = await response.json();

      document.dispatchEvent(new CartUpdateEvent(data, 'cart-rewards-component', { sections: data.sections ?? {} }));
    } finally {
      this.#isProcessing = false;
    }
  }

  /**
   * Updates the progress bar fill width, ARIA attributes, marker states, and message.
   * @param {number} totalPrice - Cart total in cents.
   */
  #updateProgressBar(totalPrice) {
    const { progressFill, progressMessage } = this.refs;

    if (!progressFill || !this.#maxThreshold) return;

    const fillPercent = Math.min((totalPrice / this.#maxThreshold) * 100, 100);
    progressFill.style.width = `${fillPercent.toFixed(1)}%`;

    const track = this.querySelector('[role="progressbar"]');
    if (track) track.setAttribute('aria-valuenow', String(totalPrice));

    this.#thresholds.forEach((threshold, index) => {
      const marker = this.querySelector(`[data-threshold-index="${index}"]`);
      if (!marker) return;
      marker.classList.toggle('cart-rewards-bar__marker--unlocked', totalPrice >= threshold.amount);
    });

    if (progressMessage) {
      const nextThreshold = this.#thresholds.find((t) => totalPrice < t.amount);
      if (nextThreshold) {
        const remaining = formatMoney(nextThreshold.amount - totalPrice, this.#moneyFormat, this.#currency);
        progressMessage.textContent = `Spend ${remaining} more for ${nextThreshold.label}`;
      } else {
        const lastThreshold = this.#thresholds[this.#thresholds.length - 1];
        progressMessage.textContent = `${lastThreshold?.label ?? 'All rewards'} unlocked!`;
      }
    }
  }
}

if (!customElements.get('cart-rewards-component')) {
  customElements.define('cart-rewards-component', CartRewardsComponent);
}
