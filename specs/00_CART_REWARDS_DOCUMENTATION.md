# Análisis Técnico: Cart Rewards — Sistema de Recompensas por Threshold

---

## Problema

El tema Heritage v3.5.0 no tiene ningún mecanismo para incentivar al usuario a aumentar el valor de su carrito mediante recompensas progresivas. El merchant necesita configurar umbrales (thresholds) de monto total del carrito que, al alcanzarse, desbloqueen automáticamente beneficios concretos:

- **Producto gratis**: se auto-agrega al carrito al cruzar el umbral; se elimina si el total cae por debajo.
- **Free shipping**: se desbloquea visualmente (UI unlock) al cruzar el umbral.

La feature debe funcionar tanto en el **cart drawer** como en la **página de carrito** (`/cart`), y debe mostrar una barra de progreso con marcadores por cada threshold configurado.

---

## Impacto Arquitectónico

### Capas afectadas

| Capa | Componente | Tipo de impacto |
|------|-----------|----------------|
| Settings globales | `config/settings_schema.json` | NUEVO grupo de settings para configurar thresholds |
| Section Liquid | `sections/main-cart.liquid` | NUEVO bloque privado insertado en el layout del carrito |
| Section Liquid | `sections/cart-drawer.liquid` | NUEVO bloque privado insertado en el drawer |
| Snippet | `snippets/cart-rewards-bar.liquid` | NUEVO snippet reutilizable para barra de progreso |
| JS Web Component | `assets/component-cart-rewards.js` | NUEVO módulo: lógica de threshold, auto-add/remove |
| ImportMap | `assets/scripts.liquid` | Registro del nuevo módulo JS |
| Block privado | `blocks/_cart-rewards.liquid` | NUEVO bloque privado con schema y render del snippet |

### Puntos de integración críticos

1. **CartUpdateEvent** y **CartAddEvent** (en `@theme/events`): el nuevo componente debe escuchar ambos para recalcular el estado de los thresholds cada vez que el carrito cambia.
2. **`/cart/add.js`** y **`/cart/change.js`**: el componente llama directamente estas APIs para auto-agregar o eliminar el producto regalo.
3. **`morphSection()`**: después de cualquier mutación del carrito, el rendering ya está manejado por `CartItemsComponent` vía morph. El componente de rewards solo necesita recalcular su propio estado interno — no re-renderiza la sección completa.
4. **`total_price` en centavos**: CartAddEvent incluye `event.detail.resource` con `total_price`. CartUpdateEvent incluye `event.detail.data` con `total_price`. Ambos están en centavos (integer).

### Restricción de plataforma crítica

Shopify no permite fijar precio $0 desde el tema sin Shopify Functions. El merchant **debe crear previamente** una variante del producto regalo con precio $0 en el admin. El tema solo puede hacer `POST /cart/add.js` con el `variant_id` de esa variante. Este requisito debe quedar documentado en la UI del admin (info text en settings).

### Riesgo de loop de eventos

Al auto-agregar el producto regalo, se dispara un `CartAddEvent`, que a su vez haría recalcular el threshold. Hay que proteger contra loops: el componente debe ignorar `CartAddEvent` cuya fuente sea él mismo, o usar una flag de `isProcessing`.

---

## Propuesta de Solución

### Diseño técnico — Clean Architecture

El sistema se divide en tres responsabilidades:

**1. Configuración (Settings Layer)**
Settings globales en `settings_schema.json` para que el merchant defina los thresholds:
- Hasta 3 thresholds configurables (threshold_1, threshold_2, threshold_3).
- Por cada threshold: monto (number), tipo de recompensa (`free_shipping` | `free_product`), y si es producto: el `variant_id` del producto regalo.
- Setting global: `cart_rewards_enabled` (checkbox).

Nota: Shopify no soporta arrays dinámicos en settings globales. Los 3 thresholds fijos son el máximo pragmático sin Metafields ni app.

**2. Presentación (Snippet + Block Layer)**
`snippets/cart-rewards-bar.liquid` genera el HTML declarativo de la barra:
- El snippet lee los settings globales, calcula los porcentajes de posición de cada marcador, y emite el HTML con `data-*` attributes que el Web Component consume.
- Incluye estado de cada threshold: `locked` | `unlocked` para renderizado inicial server-side.
- No incluye lógica JS dentro del snippet.

`blocks/_cart-rewards.liquid` es el punto de inserción en las secciones del carrito. Tiene su propio `{% schema %}` vacío (sin settings propios, usa los globales). Llama a `render 'cart-rewards-bar'`.

**3. Comportamiento (Web Component Layer)**
`assets/component-cart-rewards.js` — `CartRewardsComponent extends Component`:

```
class CartRewardsComponent extends Component {
  #isProcessing = false;

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener(ThemeEvents.cartUpdate, this.#handleCartChange);
    document.addEventListener(ThemeEvents.cartAdd, this.#handleCartChange);
  }

  #handleCartChange = async (event) => {
    if (this.#isProcessing) return;
    const totalPrice = this.#extractTotalPrice(event);
    await this.#evaluateThresholds(totalPrice);
    this.#updateProgressBar(totalPrice);
  };

  async #evaluateThresholds(totalPrice) {
    // Para cada threshold configurado via data-* attrs:
    // - Si totalPrice >= threshold.amount Y tipo == 'free_product':
    //     si no está en carrito: auto-add (con isProcessing=true)
    // - Si totalPrice < threshold.amount Y tipo == 'free_product':
    //     si está en carrito: auto-remove
    // - Si tipo == 'free_shipping': solo toggle de clase CSS
  }
}
```

La comunicación de configuración desde Liquid al JS se hace mediante `data-*` attributes en el elemento `<cart-rewards-component>`:
- `data-thresholds` — JSON con array de thresholds (amount en centavos, type, variant_id)
- `data-currency-rate` — rate para conversión si necesario (normalmente 1)

### Barra de progreso

```html
<cart-rewards-component
  data-thresholds='[{"amount": 5000, "type": "free_shipping"}, {"amount": 10000, "type": "free_product", "variant_id": "12345"}]'
>
  <div class="cart-rewards-bar">
    <div class="cart-rewards-bar__track">
      <div class="cart-rewards-bar__fill" ref="progressFill"></div>
      <!-- Marcadores posicionados via left: X% -->
      <div class="cart-rewards-bar__marker" data-threshold-index="0" style="left: 50%">
        <!-- icono + label -->
      </div>
    </div>
    <p class="cart-rewards-bar__message" ref="progressMessage">
      Te faltan $X para envío gratis
    </p>
  </div>
</cart-rewards-component>
```

---

## Plan de Implementación

### Orden de dependencias

```
Step 1: settings_schema.json  (sin dependencias)
Step 2: snippets/cart-rewards-bar.liquid  (depende de Step 1)
Step 3: blocks/_cart-rewards.liquid  (depende de Step 2)
Step 4: sections/main-cart.liquid  (depende de Step 3)
Step 5: sections/cart-drawer.liquid  (depende de Step 3)
Step 6: assets/component-cart-rewards.js  (depende de Steps 2-5)
Step 7: assets/scripts.liquid — ImportMap  (depende de Step 6)
```

---

### Step 1: `config/settings_schema.json`

Agregar nuevo grupo antes del cierre del array `]` final.

```json
{
  "name": "Cart Rewards",
  "settings": [
    {
      "type": "checkbox",
      "id": "cart_rewards_enabled",
      "label": "Enable cart rewards",
      "default": false
    },
    {
      "type": "header",
      "content": "Threshold 1"
    },
    {
      "type": "number",
      "id": "cart_rewards_threshold_1_amount",
      "label": "Amount (in store currency)",
      "default": 50
    },
    {
      "type": "select",
      "id": "cart_rewards_threshold_1_type",
      "label": "Reward type",
      "options": [
        { "value": "free_shipping", "label": "Free shipping" },
        { "value": "free_product", "label": "Free product" }
      ],
      "default": "free_shipping"
    },
    {
      "type": "text",
      "id": "cart_rewards_threshold_1_variant_id",
      "label": "Gift product variant ID",
      "info": "Required if reward type is 'Free product'. Create a $0 variant in your product admin first.",
      "visible_if": "{{ settings.cart_rewards_threshold_1_type == 'free_product' }}"
    },
    {
      "type": "text",
      "id": "cart_rewards_threshold_1_label",
      "label": "Reward label",
      "default": "Free shipping"
    },
    {
      "type": "header",
      "content": "Threshold 2"
    },
    {
      "type": "checkbox",
      "id": "cart_rewards_threshold_2_enabled",
      "label": "Enable threshold 2",
      "default": false
    },
    {
      "type": "number",
      "id": "cart_rewards_threshold_2_amount",
      "label": "Amount (in store currency)",
      "default": 100,
      "visible_if": "{{ settings.cart_rewards_threshold_2_enabled }}"
    },
    {
      "type": "select",
      "id": "cart_rewards_threshold_2_type",
      "label": "Reward type",
      "options": [
        { "value": "free_shipping", "label": "Free shipping" },
        { "value": "free_product", "label": "Free product" }
      ],
      "default": "free_product",
      "visible_if": "{{ settings.cart_rewards_threshold_2_enabled }}"
    },
    {
      "type": "text",
      "id": "cart_rewards_threshold_2_variant_id",
      "label": "Gift product variant ID",
      "info": "Required if reward type is 'Free product'. Create a $0 variant in your product admin first.",
      "visible_if": "{{ settings.cart_rewards_threshold_2_enabled and settings.cart_rewards_threshold_2_type == 'free_product' }}"
    },
    {
      "type": "text",
      "id": "cart_rewards_threshold_2_label",
      "label": "Reward label",
      "default": "Free gift",
      "visible_if": "{{ settings.cart_rewards_threshold_2_enabled }}"
    },
    {
      "type": "header",
      "content": "Threshold 3"
    },
    {
      "type": "checkbox",
      "id": "cart_rewards_threshold_3_enabled",
      "label": "Enable threshold 3",
      "default": false
    },
    {
      "type": "number",
      "id": "cart_rewards_threshold_3_amount",
      "label": "Amount (in store currency)",
      "default": 150,
      "visible_if": "{{ settings.cart_rewards_threshold_3_enabled }}"
    },
    {
      "type": "select",
      "id": "cart_rewards_threshold_3_type",
      "label": "Reward type",
      "options": [
        { "value": "free_shipping", "label": "Free shipping" },
        { "value": "free_product", "label": "Free product" }
      ],
      "default": "free_product",
      "visible_if": "{{ settings.cart_rewards_threshold_3_enabled }}"
    },
    {
      "type": "text",
      "id": "cart_rewards_threshold_3_variant_id",
      "label": "Gift product variant ID",
      "info": "Required if reward type is 'Free product'. Create a $0 variant in your product admin first.",
      "visible_if": "{{ settings.cart_rewards_threshold_3_enabled and settings.cart_rewards_threshold_3_type == 'free_product' }}"
    },
    {
      "type": "text",
      "id": "cart_rewards_threshold_3_label",
      "label": "Reward label",
      "default": "Free gift",
      "visible_if": "{{ settings.cart_rewards_threshold_3_enabled }}"
    }
  ]
}
```

---

### Step 2: CREAR `snippets/cart-rewards-bar.liquid`

Este snippet es el responsable de:
- Construir el array de thresholds activos desde settings.
- Calcular el monto máximo (el threshold más alto) para las posiciones de marcadores.
- Emitir el data-thresholds JSON en centavos (multiply amount * 100 para compatibilidad con `total_price` de la API).
- Renderizar el HTML inicial con estado server-side.

```liquid
{% comment %}
  Cart Rewards Bar Snippet
  Renderiza la barra de progreso de recompensas del carrito.

  @param {string} [context] - 'drawer' | 'page' (for CSS scoping)
{% endcomment %}

{%- unless settings.cart_rewards_enabled -%}
  {%- comment -%}Feature disabled, render nothing{%- endcomment -%}
{%- else -%}

{%- liquid
  assign active_thresholds = ''
  assign threshold_count = 0

  comment
    Threshold 1 is always active when rewards are enabled
  endcomment
  assign t1_amount_cents = settings.cart_rewards_threshold_1_amount | times: 100
  assign active_thresholds = active_thresholds | append: settings.cart_rewards_threshold_1_amount
  assign threshold_count = threshold_count | plus: 1

  if settings.cart_rewards_threshold_2_enabled
    assign threshold_count = threshold_count | plus: 1
  endif

  if settings.cart_rewards_threshold_3_enabled
    assign threshold_count = threshold_count | plus: 1
  endif

  comment
    Max threshold amount for progress bar scale
  endcomment
  assign max_threshold = settings.cart_rewards_threshold_1_amount
  if settings.cart_rewards_threshold_2_enabled and settings.cart_rewards_threshold_2_amount > max_threshold
    assign max_threshold = settings.cart_rewards_threshold_2_amount
  endif
  if settings.cart_rewards_threshold_3_enabled and settings.cart_rewards_threshold_3_amount > max_threshold
    assign max_threshold = settings.cart_rewards_threshold_3_amount
  endif
  assign max_threshold_cents = max_threshold | times: 100

  comment
    Build thresholds JSON for JS consumption (amounts in cents)
  endcomment
  assign t1_cents = settings.cart_rewards_threshold_1_amount | times: 100
  assign t1_position = settings.cart_rewards_threshold_1_amount | times: 100 | divided_by: max_threshold_cents | times: 100
-%}

{%- capture thresholds_json -%}
  [
    {
      "amount": {{ t1_cents }},
      "type": "{{ settings.cart_rewards_threshold_1_type }}",
      "variant_id": "{{ settings.cart_rewards_threshold_1_variant_id }}",
      "label": {{ settings.cart_rewards_threshold_1_label | json }},
      "position": {{ t1_position | round: 1 }}
    }
    {%- if settings.cart_rewards_threshold_2_enabled -%}
      {%- liquid
        assign t2_cents = settings.cart_rewards_threshold_2_amount | times: 100
        assign t2_position = settings.cart_rewards_threshold_2_amount | times: 100 | divided_by: max_threshold_cents | times: 100
      -%}
    ,{
      "amount": {{ t2_cents }},
      "type": "{{ settings.cart_rewards_threshold_2_type }}",
      "variant_id": "{{ settings.cart_rewards_threshold_2_variant_id }}",
      "label": {{ settings.cart_rewards_threshold_2_label | json }},
      "position": {{ t2_position | round: 1 }}
    }
    {%- endif -%}
    {%- if settings.cart_rewards_threshold_3_enabled -%}
      {%- liquid
        assign t3_cents = settings.cart_rewards_threshold_3_amount | times: 100
        assign t3_position = settings.cart_rewards_threshold_3_amount | times: 100 | divided_by: max_threshold_cents | times: 100
      -%}
    ,{
      "amount": {{ t3_cents }},
      "type": "{{ settings.cart_rewards_threshold_3_type }}",
      "variant_id": "{{ settings.cart_rewards_threshold_3_variant_id }}",
      "label": {{ settings.cart_rewards_threshold_3_label | json }},
      "position": {{ t3_position | round: 1 }}
    }
    {%- endif -%}
  ]
{%- endcapture -%}

{%- assign cart_total_cents = cart.total_price -%}

<cart-rewards-component
  class="cart-rewards-component"
  data-thresholds="{{ thresholds_json | strip_newlines | escape }}"
  data-max-threshold="{{ max_threshold_cents }}"
  data-cart-total="{{ cart_total_cents }}"
  {% if context == 'drawer' %}data-drawer{% endif %}
>
  <div class="cart-rewards-bar" aria-label="Cart rewards progress">
    <div class="cart-rewards-bar__track" role="progressbar" aria-valuenow="{{ cart_total_cents }}" aria-valuemax="{{ max_threshold_cents }}">
      {%- assign fill_percent = cart_total_cents | times: 100.0 | divided_by: max_threshold_cents | at_most: 100 -%}
      <div
        class="cart-rewards-bar__fill"
        ref="progressFill"
        style="width: {{ fill_percent | round: 1 }}%"
      ></div>

      {%- comment -%}Threshold markers{%- endcomment -%}
      {%- assign threshold_1_unlocked = false -%}
      {%- if cart_total_cents >= t1_cents -%}{%- assign threshold_1_unlocked = true -%}{%- endif -%}
      <div
        class="cart-rewards-bar__marker{% if threshold_1_unlocked %} cart-rewards-bar__marker--unlocked{% endif %}"
        data-threshold-index="0"
        style="left: {{ t1_position | round: 1 }}%"
        aria-label="{{ settings.cart_rewards_threshold_1_label }}"
      >
        <span class="cart-rewards-bar__marker-icon">
          {%- if settings.cart_rewards_threshold_1_type == 'free_shipping' -%}
            {%- render 'icon', icon: 'delivery' -%}
          {%- else -%}
            {%- render 'icon', icon: 'gift' -%}
          {%- endif -%}
        </span>
      </div>

      {%- if settings.cart_rewards_threshold_2_enabled -%}
        {%- assign threshold_2_unlocked = false -%}
        {%- assign t2_cents_check = settings.cart_rewards_threshold_2_amount | times: 100 -%}
        {%- if cart_total_cents >= t2_cents_check -%}{%- assign threshold_2_unlocked = true -%}{%- endif -%}
        {%- assign t2_pos = settings.cart_rewards_threshold_2_amount | times: 100 | divided_by: max_threshold_cents | times: 100 -%}
        <div
          class="cart-rewards-bar__marker{% if threshold_2_unlocked %} cart-rewards-bar__marker--unlocked{% endif %}"
          data-threshold-index="1"
          style="left: {{ t2_pos | round: 1 }}%"
          aria-label="{{ settings.cart_rewards_threshold_2_label }}"
        >
          <span class="cart-rewards-bar__marker-icon">
            {%- if settings.cart_rewards_threshold_2_type == 'free_shipping' -%}
              {%- render 'icon', icon: 'delivery' -%}
            {%- else -%}
              {%- render 'icon', icon: 'gift' -%}
            {%- endif -%}
          </span>
        </div>
      {%- endif -%}

      {%- if settings.cart_rewards_threshold_3_enabled -%}
        {%- assign threshold_3_unlocked = false -%}
        {%- assign t3_cents_check = settings.cart_rewards_threshold_3_amount | times: 100 -%}
        {%- if cart_total_cents >= t3_cents_check -%}{%- assign threshold_3_unlocked = true -%}{%- endif -%}
        {%- assign t3_pos = settings.cart_rewards_threshold_3_amount | times: 100 | divided_by: max_threshold_cents | times: 100 -%}
        <div
          class="cart-rewards-bar__marker{% if threshold_3_unlocked %} cart-rewards-bar__marker--unlocked{% endif %}"
          data-threshold-index="2"
          style="left: {{ t3_pos | round: 1 }}%"
          aria-label="{{ settings.cart_rewards_threshold_3_label }}"
        >
          <span class="cart-rewards-bar__marker-icon">
            {%- if settings.cart_rewards_threshold_3_type == 'free_shipping' -%}
              {%- render 'icon', icon: 'delivery' -%}
            {%- else -%}
              {%- render 'icon', icon: 'gift' -%}
            {%- endif -%}
          </span>
        </div>
      {%- endif -%}
    </div>

    <p class="cart-rewards-bar__message body-sm" ref="progressMessage">
      {%- comment -%}
        Message inicial server-side: se actualiza por JS en cliente.
        Muestra el próximo threshold no alcanzado.
      {%- endcomment -%}
      {%- if threshold_1_unlocked == false -%}
        {%- assign remaining_cents = t1_cents | minus: cart_total_cents -%}
        Spend {{ remaining_cents | divided_by: 100.0 | money }} more for {{ settings.cart_rewards_threshold_1_label }}
      {%- else -%}
        {{ settings.cart_rewards_threshold_1_label }} unlocked!
      {%- endif -%}
    </p>
  </div>
</cart-rewards-component>

{%- endunless -%}
```

---

### Step 3: CREAR `blocks/_cart-rewards.liquid`

Bloque privado (prefijo `_`) que inserta el snippet en las secciones del carrito.

```liquid
{%- render 'cart-rewards-bar', context: block.settings.context -%}

{% schema %}
{
  "name": "Cart Rewards Bar",
  "target": "section",
  "settings": []
}
{% endschema %}
```

---

### Step 4: MODIFICAR `sections/main-cart.liquid`

Insertar el bloque `_cart-rewards` en la posición correcta: dentro del layout principal del carrito, entre el título y los items (o encima del summary). El punto de inserción correcto es dentro del `cart_items_children` capture, después de `cart-page__title` y antes de `cart-page__items`.

Cambio específico (en ambas instancias del layout: dentro del `<template>` y en el HTML principal):

```liquid
{%- comment -%}Agregar después de la div cart-page__title:{%- endcomment -%}
<div class="cart-page__rewards">
  {%- content_for 'block', id: 'cart-page-rewards', type: '_cart-rewards' %}
</div>
```

El bloque `_cart-rewards` no necesita `force_empty: true` en la template porque siempre debe renderizarse (cuando rewards está habilitado, el snippet se encarga de la condición).

---

### Step 5: MODIFICAR `sections/cart-drawer.liquid`

Validar la estructura del drawer (leer el archivo antes de modificar). El punto de inserción equivalente al del cart page, con `context: 'drawer'` pasado via el bloque.

Nota: el bloque `_cart-rewards` en el drawer necesita pasar el contexto `drawer`. Como los blocks no tienen params dinámicos de la sección padre, la solución más limpia es que el snippet lea el `data-drawer` attribute del `cart-items-component` más cercano — esto es inspeccionable desde JS. Para el render server-side, el snippet puede inferir el contexto desde si está dentro de una sección con `is_drawer: true`.

Alternativa más pragmática: crear dos snippets separados `cart-rewards-bar.liquid` y `cart-rewards-bar-drawer.liquid`, o pasar el contexto vía un setting del bloque. Recomendación: usar un setting `context` en el schema del bloque:

```json
{
  "name": "Cart Rewards Bar",
  "target": "section",
  "settings": [
    {
      "type": "select",
      "id": "context",
      "label": "Context",
      "options": [
        { "value": "page", "label": "Cart page" },
        { "value": "drawer", "label": "Cart drawer" }
      ],
      "default": "page"
    }
  ]
}
```

Y en el snippet: `{% render 'cart-rewards-bar', context: block.settings.context %}`.

---

### Step 6: CREAR `assets/component-cart-rewards.js`

```javascript
import { Component } from '@theme/component';
import { fetchConfig } from '@theme/utilities';
import { ThemeEvents, CartUpdateEvent, CartAddEvent } from '@theme/events';

/**
 * CartRewardsComponent
 *
 * Manages cart threshold rewards: evaluates thresholds on cart changes,
 * auto-adds/removes free products, and updates the progress bar UI.
 *
 * @typedef {object} Refs
 * @property {HTMLElement} progressFill - The progress bar fill element.
 * @property {HTMLElement} progressMessage - The message element.
 *
 * @extends {Component<Refs>}
 */
class CartRewardsComponent extends Component {
  /** @type {boolean} Prevents event loop when auto-adding/removing gift products */
  #isProcessing = false;

  /** @type {Array<{amount: number, type: string, variant_id: string, label: string, position: number}>} */
  #thresholds = [];

  /** @type {number} Maximum threshold amount in cents */
  #maxThreshold = 0;

  connectedCallback() {
    super.connectedCallback();

    this.#thresholds = JSON.parse(
      decodeURIComponent(this.dataset.thresholds || '[]')
    );
    this.#maxThreshold = parseInt(this.dataset.maxThreshold || '0', 10);

    document.addEventListener(ThemeEvents.cartUpdate, this.#handleCartChange);
    document.addEventListener(ThemeEvents.cartAdd, this.#handleCartChange);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener(ThemeEvents.cartUpdate, this.#handleCartChange);
    document.removeEventListener(ThemeEvents.cartAdd, this.#handleCartChange);
  }

  /**
   * @param {CartUpdateEvent | CartAddEvent} event
   */
  #handleCartChange = async (event) => {
    if (this.#isProcessing) return;

    const totalPrice = this.#extractTotalPrice(event);
    if (totalPrice === null) return;

    await this.#evaluateThresholds(totalPrice, event);
    this.#updateProgressBar(totalPrice);
  };

  /**
   * Extracts total_price (in cents) from CartUpdateEvent or CartAddEvent.
   * @param {CartUpdateEvent | CartAddEvent} event
   * @returns {number | null}
   */
  #extractTotalPrice(event) {
    if (event instanceof CartAddEvent) {
      return event.detail?.resource?.total_price ?? null;
    }
    if (event instanceof CartUpdateEvent) {
      return event.detail?.data?.total_price ?? null;
    }
    return null;
  }

  /**
   * Evaluates all thresholds and triggers auto-add/remove for free product rewards.
   * @param {number} totalPrice - Cart total in cents.
   * @param {CartUpdateEvent | CartAddEvent} event - Original event for context.
   */
  async #evaluateThresholds(totalPrice, event) {
    for (let i = 0; i < this.#thresholds.length; i++) {
      const threshold = this.#thresholds[i];

      if (threshold.type !== 'free_product' || !threshold.variant_id) continue;

      const isUnlocked = totalPrice >= threshold.amount;
      const variantId = parseInt(threshold.variant_id, 10);

      // Get current cart to check if gift is already in cart
      const cart = await this.#fetchCart();
      if (!cart) continue;

      const giftItem = cart.items?.find((item) => item.variant_id === variantId);
      const isGiftInCart = Boolean(giftItem);

      if (isUnlocked && !isGiftInCart) {
        await this.#addGiftProduct(variantId);
        this.#markThresholdUnlocked(i);
      } else if (!isUnlocked && isGiftInCart) {
        await this.#removeGiftProduct(giftItem.line);
        this.#markThresholdLocked(i);
      }
    }
  }

  /**
   * Fetches current cart state.
   * @returns {Promise<Object|null>}
   */
  async #fetchCart() {
    try {
      const response = await fetch(`${Theme.routes.root}cart.js`);
      return await response.json();
    } catch {
      return null;
    }
  }

  /**
   * Auto-adds the gift product to the cart.
   * @param {number} variantId
   */
  async #addGiftProduct(variantId) {
    this.#isProcessing = true;
    try {
      const body = JSON.stringify({
        items: [{ id: variantId, quantity: 1 }],
        sections: [],
      });
      await fetch(`${Theme.routes.cart_add_url}`, fetchConfig('json', { body }));
    } finally {
      this.#isProcessing = false;
    }
  }

  /**
   * Removes the gift product from the cart by line number.
   * @param {number} line - 1-based line number in cart.
   */
  async #removeGiftProduct(line) {
    this.#isProcessing = true;
    try {
      const body = JSON.stringify({ line, quantity: 0 });
      await fetch(`${Theme.routes.cart_change_url}`, fetchConfig('json', { body }));
    } finally {
      this.#isProcessing = false;
    }
  }

  /**
   * Updates the visual progress bar width and message.
   * @param {number} totalPrice - Cart total in cents.
   */
  #updateProgressBar(totalPrice) {
    const { progressFill, progressMessage } = this.refs;

    if (!progressFill || !this.#maxThreshold) return;

    const fillPercent = Math.min((totalPrice / this.#maxThreshold) * 100, 100);
    progressFill.style.width = `${fillPercent.toFixed(1)}%`;

    // Update ARIA
    const track = this.querySelector('[role="progressbar"]');
    if (track) track.setAttribute('aria-valuenow', String(totalPrice));

    // Update message: find next locked threshold
    if (progressMessage) {
      const nextThreshold = this.#thresholds.find((t) => totalPrice < t.amount);
      if (nextThreshold) {
        const remaining = ((nextThreshold.amount - totalPrice) / 100).toFixed(2);
        progressMessage.textContent = `Spend $${remaining} more for ${nextThreshold.label}`;
      } else {
        const lastThreshold = this.#thresholds[this.#thresholds.length - 1];
        progressMessage.textContent = `${lastThreshold?.label ?? 'All rewards'} unlocked!`;
      }
    }

    // Update marker classes
    this.#thresholds.forEach((threshold, index) => {
      const marker = this.querySelector(`[data-threshold-index="${index}"]`);
      if (!marker) return;
      if (totalPrice >= threshold.amount) {
        marker.classList.add('cart-rewards-bar__marker--unlocked');
      } else {
        marker.classList.remove('cart-rewards-bar__marker--unlocked');
      }
    });
  }

  #markThresholdUnlocked(index) {
    const marker = this.querySelector(`[data-threshold-index="${index}"]`);
    marker?.classList.add('cart-rewards-bar__marker--unlocked');
  }

  #markThresholdLocked(index) {
    const marker = this.querySelector(`[data-threshold-index="${index}"]`);
    marker?.classList.remove('cart-rewards-bar__marker--unlocked');
  }
}

customElements.define('cart-rewards-component', CartRewardsComponent);
```

---

### Step 7: Registrar en ImportMap (`assets/scripts.liquid`)

Agregar al ImportMap existente:

```liquid
"@theme/cart-rewards": "{{ 'component-cart-rewards.js' | asset_url }}",
```

Y agregar el script tag de carga (si el tema usa type="module" lazy loading):

```liquid
<script src="{{ 'component-cart-rewards.js' | asset_url }}" type="module"></script>
```

El patrón exacto depende de cómo `assets/scripts.liquid` registra los otros componentes del carrito. Verificar el patrón de `component-cart-items.js` en el ImportMap.

---

## Edge Cases a Manejar

| Caso | Manejo |
|------|--------|
| Loop de eventos al auto-add | Flag `#isProcessing = true` durante el fetch; el handler retorna inmediatamente si está activo |
| Usuario elimina manualmente el producto regalo | `CartUpdateEvent` se dispara → `#evaluateThresholds` verifica: si el total todavía supera el threshold, lo vuelve a agregar |
| Total del carrito cambia por coupon | `DiscountUpdateEvent` → `CartItemsComponent` ya re-renderiza la sección; el `CartUpdateEvent` subsecuente actualiza la barra |
| Dos thresholds de tipo `free_product` con el mismo variant_id | No es un caso soportado; documentar que cada threshold debe tener variant_id único |
| `total_price` no disponible en el evento | `#extractTotalPrice` retorna `null` → el handler hace early return sin llamar a `#fetchCart` |
| Carrito vacío después de remover gift | `CartItemsComponent` ya maneja el estado vacío (empty-cart-template). La barra debe ocultarse cuando el carrito está vacío: CSS `cart-rewards-component:empty` o condición Liquid `unless cart.empty?` en el snippet |
| Settings globales `cart_rewards_enabled = false` | El snippet no renderiza nada → no se monta el Web Component → sin overhead JS |
| Monedas con rate != 1 | `total_price` de la API Storefront siempre está en la moneda de la tienda en centavos; los thresholds también se guardan en esa moneda → no hay conversión necesaria |
| Threshold con `variant_id` vacío y tipo `free_product` | El JS verifica `if (!threshold.variant_id) continue` → skip silencioso |
| Drawer + page cart simultaneos en el DOM | Ambos `cart-rewards-component` escuchan los mismos eventos — cada uno actualiza su propio DOM independientemente. No hay conflicto porque `#isProcessing` es instancia-level, no global. Riesgo: doble llamada a `/cart/add.js`. Mitigación: verificar primero con `#fetchCart()` si el gift ya está en el carrito antes de agregar |

---

## Restricciones y Requisitos para el Merchant

1. **Producto regalo con precio $0**: debe crearse manualmente en el admin de Shopify. El tema no puede forzar precio $0 sin Shopify Functions.
2. **Variant ID del producto regalo**: debe copiarse del URL del producto en el admin (`/admin/products/PRODUCT_ID/variants/VARIANT_ID`) y pegarse en el setting `cart_rewards_threshold_X_variant_id`.
3. **Moneda**: los amounts se configuran en la moneda base de la tienda.

---

## Archivos Resumen

| Archivo | Acción | Descripción |
|---------|--------|-------------|
| `config/settings_schema.json` | MODIFICAR | Agregar grupo "Cart Rewards" con settings de thresholds |
| `snippets/cart-rewards-bar.liquid` | CREAR | Snippet HTML + data attrs para el Web Component |
| `blocks/_cart-rewards.liquid` | CREAR | Bloque privado con schema para insertar en secciones |
| `sections/main-cart.liquid` | MODIFICAR | Insertar bloque `_cart-rewards` en el layout |
| `sections/cart-drawer.liquid` | MODIFICAR | Insertar bloque `_cart-rewards` con context=drawer |
| `assets/component-cart-rewards.js` | CREAR | Web Component: lógica de thresholds, auto-add/remove, UI |
| `assets/scripts.liquid` | MODIFICAR | Registrar `component-cart-rewards.js` en ImportMap |
