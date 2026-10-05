# Presupuestos

App web para hacer presupuestos y recuperar a qué precio presupuestaste cada material a cada cliente.
Funciona en el navegador (ordenador o móvil), sin instalar nada.

## Funciones

- **Buscar precios**: escribe el cliente y el material (p. ej. «camisetas») y verás todas las veces que se lo
  presupuestaste, con el último precio, el mínimo y el máximo. «Usar» añade esa línea a un presupuesto nuevo.
- **Presupuesto**: al escribir un concepto te sugiere el último precio a ese cliente (o a otro, si nunca se lo
  presupuestaste). Calcula descuentos, IVA y total, y numera solo (2026-001, 2026-002…).
  «Imprimir / PDF» lo saca con tus datos de empresa (pestaña Ajustes).
- **Historial**: abre, duplica o borra presupuestos.
- **Importar PDF**: lee cliente, fecha, número y líneas (concepto, cantidad, precio) de tus presupuestos en PDF
  y te los enseña para revisarlos antes de guardar. Los PDF escaneados no tienen texto que leer.

## Datos

Se guardan en el navegador. Usa «Descargar copia» (pestaña Importar PDF) para tener una copia de seguridad o pasarlos
a otro equipo. Los presupuestos de `datos.json` se añaden solos al abrir la app.

## Publicación (GitHub Pages)

**Settings → Pages → Build and deployment → Source: Deploy from a branch**, rama `main`, carpeta **/ (root)**.
Quedará en `https://hectorlagocarrera.github.io/presupuestos/`.

## Archivos

- `index.html`, `styles.css`, `app.js`: la app.
- `parser.js`: lectura de PDF (texto → líneas de presupuesto), números en formato español y búsqueda.
- `datos.json`: presupuestos iniciales que se cargan en la app.
