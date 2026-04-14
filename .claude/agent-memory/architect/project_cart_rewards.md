---
name: Cart Rewards Feature
description: Planned threshold-based cart rewards system — free shipping unlock and free product auto-add
type: project
---

El merchant necesita un sistema de recompensas por umbrales del carrito (Cart Rewards / Threshold System) para el tema Heritage v3.5.0.

**Why:** Incentivar al usuario a aumentar el valor del carrito. Cada threshold desbloquea envío gratis (UI unlock) o producto gratis (auto-add/remove en el carrito).

**How to apply:** Diseño arquitectónico completo documentado en `CART_REWARDS_DOCUMENTATION.md`. El plan cubre 7 pasos ordenados por dependencias: settings_schema → snippet → block privado → sections → JS Web Component → ImportMap. La restricción crítica es que el producto regalo debe tener precio $0 configurado manualmente en el admin (el tema no puede forzarlo sin Shopify Functions).

Decisiones clave tomadas:
- Hasta 3 thresholds fijos en settings globales (límite de Shopify para settings sin Metafields/app).
- La comunicación de config Liquid→JS se hace vía `data-thresholds` JSON en el custom element.
- Flag `#isProcessing` en el Web Component para evitar loops de eventos al auto-add.
- Verificación con `GET /cart.js` antes de cada auto-add/remove para evitar llamadas duplicadas en escenario drawer+page simultáneos.
