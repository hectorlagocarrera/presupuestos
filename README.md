# Presupuestos

Aplicación para hacer presupuestos nuevos usando como referencia los presupuestos históricos de la empresa.
Busca por **artículo, trabajo, material, medidas o descripción** (el cliente es secundario), reconoce sinónimos
(Alupanel = Dibond = panel composite…), compara precios entre años y reutiliza partidas con un clic.

El diseño completo (arquitectura, base de datos, pantallas, búsqueda e importación) está en [`docs/DISENO.md`](docs/DISENO.md).

## Uso

Abre `https://hectorlagocarrera.github.io/presupuestos/` en Chrome o Edge en el ordenador de la oficina.

1. **Importar**: arrastra los PDF de presupuestos que saca el programa de gestión (uno por año, con todos los
   presupuestos dentro), revisa lo detectado y pulsa **Guardar todos**. También admite Excel, CSV y texto pegado.
   Los datos de la empresa se rellenan solos desde el PDF; el logotipo (`logo.png`) ya viene puesto.
2. **Ajustes**: revisa los datos de la empresa y, si quieres, añade sinónimos propios.
3. **Nuevo presupuesto**: escribe el trabajo en la partida (p. ej. «Alupanel» y medidas 3 × 2). A la derecha salen
   los trabajos parecidos con último precio, medio, mínimo, máximo, €/m² y evolución por año. Pulsa
   **Usar como referencia** o arrastra el resultado a la izquierda, ajusta y guarda. Lo guardado pasa al histórico.

## Privacidad

- Los datos (presupuestos, clientes y archivos originales) se guardan **solo en el navegador** de ese ordenador.
  No se envían a ningún servidor: la página tiene prohibido conectarse a otros sitios.
- Este repositorio solo contiene el programa. **No subas aquí presupuestos ni datos de clientes.**
- Haz copias de seguridad desde **Importar → Copia de seguridad** y guárdalas en un sitio seguro de la empresa.

## Desarrollo

Sin compilación: HTML, CSS y JavaScript (módulos ES). Pruebas del buscador y del importador: `npm test` (Node 20+).

```
index.html, styles.css
js/util.js       formatos, números en español, cálculos de m² y €/m²
js/search.js     búsqueda inteligente: sinónimos, medidas, puntuación, estadísticas de precio
js/parse.js      detección de partidas en PDF/texto y Excel
js/store.js      base de datos local (IndexedDB) y copias de seguridad
js/ui/*.js       pantallas
vendor/          pdf.js y SheetJS (licencia Apache 2.0), incluidos para no depender de internet
```

Publicación: **Settings → Pages → Deploy from a branch → `main` / (root)**.
