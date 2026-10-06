# Presupuestos

Aplicación para hacer presupuestos nuevos usando como referencia los presupuestos históricos de la empresa.
Busca por **artículo, trabajo, material, medidas o descripción** (el cliente es secundario), reconoce sinónimos
(Alupanel = Dibond = panel composite…), compara precios entre años y reutiliza partidas con un clic.

El diseño completo (arquitectura, base de datos, pantallas, búsqueda e importación) está en [`docs/DISENO.md`](docs/DISENO.md).

## Instalación en el servidor (recomendado)

Guía paso a paso para el VPS de OVH: [`deploy/GUIA-VPS.md`](deploy/GUIA-VPS.md). Basta con dos comandos:

```
curl -fsSLO https://raw.githubusercontent.com/hectorlagocarrera/presupuestos/main/deploy/instalar.sh
sudo bash instalar.sh
```

Con servidor, los datos se guardan en una **base de datos SQLite** en el VPS. Todos los ordenadores ven lo
mismo, se entra con usuario y contraseña, y hay una copia de seguridad cada noche.

Sin servidor (abriendo la página tal cual, por ejemplo en GitHub Pages), la aplicación funciona igual pero guarda
los datos en el navegador.

## Uso

1. **Importar**: arrastra los PDF de presupuestos que saca el programa de gestión (uno por año, con todos los
   presupuestos dentro), revisa lo detectado y pulsa **Guardar todos**. También admite Excel, CSV y texto pegado.
   Los datos de la empresa se rellenan solos desde el PDF y el logotipo ya viene puesto.
2. **Nuevo presupuesto**: escribe el trabajo en la partida (por ejemplo «Alupanel» y medidas 3 × 2). A la derecha
   salen los trabajos parecidos con último precio, medio, mínimo, máximo, €/m² habitual y evolución por año.
   Pulsa **Usar como referencia** o arrastra el resultado a la izquierda, ajusta y guarda. Lo guardado pasa al
   histórico.
3. **Tarifa**: tarifa de precios sacada de todos los presupuestos (precio sugerido por artículo, en €/m² o por
   unidad). Fija tus precios, aplica un % general, quita lo que no quieras y descárgala en Excel o imprímela.
4. **Tema**: botón arriba a la derecha para elegir entre automático, claro y oscuro (letras naranjas).

## Privacidad

- Este repositorio solo contiene el programa. **No subas aquí presupuestos ni datos de clientes.**
- Con servidor, los datos solo se leen con usuario y contraseña (sesión con cookie segura y bloqueo tras
  intentos fallidos). Sin servidor, no salen del navegador.

## Desarrollo

Sin compilación: HTML, CSS y JavaScript (módulos ES). Pruebas: `npm test` (Node 22+).
Servidor en local: `node server/usuarios.js nuevo yo` y después `node server/server.js` → <http://127.0.0.1:3000>.

```
index.html, styles.css
js/util.js       formatos, números en español, cálculos de m² y €/m²
js/search.js     búsqueda inteligente: sinónimos, medidas, puntuación, estadísticas de precio
js/parse.js      detección de partidas en PDF/texto y Excel
js/store.js      datos en memoria, guardado (en bloque para importaciones) y copias de seguridad
js/backend.js    dónde se guarda: API del servidor o IndexedDB del navegador
js/columnas.js   lector a medida de los PDF del programa de gestión
js/tarifa.js     tarifa de precios: agrupación de artículos y precio sugerido
server/          servidor Node.js (sin dependencias): API, usuarios, base de datos SQLite (node:sqlite)
deploy/          instalación en el VPS (instalar.sh) y guía
js/ui/*.js       pantallas
vendor/          pdf.js y SheetJS (licencia Apache 2.0), incluidos para no depender de internet
```

