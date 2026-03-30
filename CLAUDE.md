# CLAUDE.md — Heritage Shopify Theme

Guía de contexto para el desarrollo del tema **Heritage v3.5.0** de Shopify.

---

## Proyecto

- **Tema:** Heritage v3.5.0 (autor: Shopify)
- **Directorio del tema:** `claude-code-theme/`
- **Plataforma:** Shopify Online Store 2.0

---

## Estructura de Directorios

```
claude-code-theme/
├── layout/      (2)   — layout/theme.liquid: raíz HTML de todas las páginas
├── templates/   (13)  — JSON: definen qué secciones componen cada tipo de página
├── sections/    (41)  — Bloques de composición de páginas (.liquid)
├── blocks/      (93)  — Componentes reutilizables; _ prefix = privados/internos
├── snippets/    (103) — Partials Liquid compartidos entre blocks y sections
├── assets/      (113) — JS (75 módulos), CSS (3 archivos), SVG (33 iconos)
├── config/
│   ├── settings_schema.json  — EDITABLE: define settings del admin de Shopify
│   └── settings_data.json    — AUTO-GENERADO por Shopify, no editar a mano
└── locales/     (51)  — Traducciones i18n (ignoradas en .claudeignore)
```

---

## Flujo de Rendering

```
layout/theme.liquid  (raíz)
  ├── <head>: meta-tags, stylesheets, fonts, color-schemes, scripts (ImportMap)
  └── <body>
      ├── sections 'header-group'   → header-group.json
      ├── <main> content_for_layout → templates/[page].json
      │       └── sections → blocks → snippets
      ├── sections 'footer-group'   → footer-group.json
      └── Modales globales: search-modal, quick-add-modal
```

---

## Jerarquía de Componentes

```
Template JSON
  └─ Section (.liquid + schema JSON embebido)
       └─ Block (.liquid + schema JSON embebido)
            └─ Snippet (.liquid, sin schema)
                  └─ Web Component (.js, extiende DeclarativeShadowElement)
```

### Nomenclatura de Blocks

| Patrón | Tipo | Uso |
|--------|------|-----|
| `button.liquid` | Público | El merchant lo agrega desde el editor |
| `_product-details.liquid` | Privado (prefijo `_`) | Usado internamente por el bloque padre |

---

## Sistema de Theming

### CSS Custom Properties

Todo el color y tipografía se expone como CSS variables, nunca hardcodeado:

```
settings_schema.json  →  define 6 esquemas de color
settings_data.json    →  valores RGB por esquema
color-schemes.liquid  →  genera :root { --color-background, --color-foreground... }
theme-styles-variables.liquid  →  variables de tipografía y spacing
```

### 6 Esquemas de Color Predefinidos

| Esquema | Fondo | Texto |
|---------|-------|-------|
| scheme-1 | `#202219` (dark) | `#f6eddd` (light) |
| scheme-2 | `#ffffff` (light) | `#000000` (dark) |
| scheme-3 | Olive verde | claro |
| scheme-4 | Tan/marrón | claro |
| scheme-5 | `#000000` (black) | claro |
| scheme-6 | Transparente | — |

### Tipografía Predeterminada

- Familia base: **Instrument Sans** (todas las variantes)
- H1: 72px · H2: 48px · H3: 32px · H4: 20px · Párrafo: 14px

---

## Arquitectura JavaScript

```
assets/scripts.liquid  →  ImportMap declara los 75 módulos JS

Base: component.js  →  DeclarativeShadowElement
  ├─ Refs: elementos via atributo ref=""
  ├─ Mutation observers para cambios en DOM
  └─ Hydratación declarativa on-demand
```

### Módulos por Dominio

| Dominio | Archivos clave |
|---------|---------------|
| Producto | `variant-picker.js`, `product-form.js`, `swatches.js`, `media-gallery.js` |
| Cart | `cart-drawer.js`, `cart-items-component.js`, `quick-add.js` |
| Navegación | `header.js`, `header-drawer.js`, `predictive-search.js`, `overflow-list.js` |
| Performance | `view-transitions.js`, `section-hydration.js`, `paginated-list.js` |
| UI | `slideshow.js`, `accordion-custom.js`, `comparison-slider.js` |

---

## Snippets de Estilo (Patrón Importante)

Los snippets de estilo generan CSS inline a partir de settings. No renderizan HTML propio.

| Snippet | Genera |
|---------|--------|
| `spacing-style.liquid` | `padding-block`, `padding-inline` |
| `border-override.liquid` | `border-width`, `border-color`, `border-radius` |
| `layout-panel-style.liquid` | Flexbox direction, alignment, gap |
| `gap-style.liquid` | Gap entre items del grid |
| `size-style.liquid` | Width / height |
| `typography-style.liquid` | font-size, line-height, letter-spacing |

Patrón de uso en snippets:
```liquid
{% capture styles %}
  padding-block: {{ section.settings.padding }}px;
{% endcapture %}
<div style="{{ styles }}">
```

---

## Flujo de Datos: Settings → Pantalla

```
settings_schema.json  (define qué settings existen)
       ↓
settings_data.json    (valores actuales)
       ↓
Section settings en template JSON
       ↓
Block settings en section JSON
       ↓
render 'spacing-style' / 'border-override' / 'color-schemes'
       ↓
style="..." atributos inline con CSS variables
```

---

## Secciones Principales (sections/)

| Sección | Propósito |
|---------|-----------|
| `header.liquid` | Logo, menú, búsqueda, localización |
| `footer.liquid` | Contenido del footer |
| `hero.liquid` | Imagen/video full-width con texto |
| `product-information.liquid` | Detalle de producto (galería + info) |
| `featured-product.liquid` | Showcase de producto único |
| `featured-collection.liquid` | Grid de colección destacada |
| `main-collection.liquid` | Colección con filtros y sorting |
| `main-cart.liquid` | Página del carrito |
| `slideshow.liquid` | Carrusel de imágenes |
| `search-results.liquid` | Resultados de búsqueda |
| `main-blog.liquid` / `main-blog-post.liquid` | Blog |

---

## Snippets Críticos (snippets/)

| Snippet | Rol |
|---------|-----|
| `product-card.liquid` | Renderiza tarjeta de producto |
| `product-media-gallery-content.liquid` | Galería de imágenes del producto |
| `variant-main-picker.liquid` | Selector de variantes |
| `quantity-selector.liquid` | Input de cantidad |
| `add-to-cart-button.liquid` | Botón agregar al carrito |
| `header-drawer.liquid` | Menú móvil |
| `predictive-search.liquid` | Búsqueda con autocomplete |
| `pagination-controls.liquid` | Paginación de colecciones |
| `color-schemes.liquid` | Genera CSS vars de esquemas de color |
| `scripts.liquid` | ImportMap + carga de módulos JS |

---

## Features Flags (settings_schema.json)

| Setting | Descripción |
|---------|-------------|
| `page_transition_enabled` | View Transitions API entre páginas |
| `transition_to_main_product` | Animación al hacer click en product card |
| `quick_add` | Modal de quick add al carrito |
| `cart_type` | `"drawer"` o `"page"` |
| `show_variant_image` | Preview de imagen al hover en variante |
| `currency_code_enabled_product_cards` | Mostrar código moneda en cards |

---

## Convenciones de Desarrollo

1. **Nunca editar `settings_data.json`** — es generado por Shopify admin.
2. **Settings globales** van en `settings_schema.json`.
3. **Settings de sección** se definen en el bloque `{% schema %}` dentro del `.liquid`.
4. **Lógica compartida** va en `snippets/`, no duplicar en blocks/sections.
5. **JS nuevo** debe registrarse en el ImportMap dentro de `assets/scripts.liquid`.
6. **Colores** siempre via CSS variables (`--color-primary`), nunca valores hardcodeados.
7. **Responsive**: cada setting de spacing/size tiene variante mobile y desktop.
8. **Iconos**: referenciar via `render 'icon', icon: 'nombre'` — los SVG están en `assets/`.

---

## Archivos Ignorados (.claudeignore)

- `claude-code-theme/locales/` — traducciones, no afectan lógica
- `claude-code-theme/assets/*.svg` — íconos estáticos
- `claude-code-theme/config/settings_data.json` — estado runtime de Shopify
