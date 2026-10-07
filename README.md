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
   **No se duplican**: si ya existe un documento del mismo tipo con el mismo número en el mismo año (o, sin
   número, con la misma fecha, cliente y total), se avisa en la revisión, «Guardar todos» lo salta y «Guardar» pide
   confirmación. Al guardar un albarán con un número que ya existe también se pide confirmación.
2. **Nuevo albarán**: elige el tipo (albarán, presupuesto o factura; cada uno con su numeración), escribe el trabajo en la partida con las medidas en el mismo texto (por ejemplo «Alupanel 3x2»; no hay casillas de
   ancho y alto). A la derecha
   salen los trabajos parecidos con último precio, medio, mínimo, máximo, €/m² habitual y evolución por año.
   Pulsa **Usar como referencia** o arrastra el resultado a la izquierda, ajusta y guarda. Lo guardado pasa al
   histórico. Al imprimir sale solo el documento, sin la fecha, el título ni la dirección web del navegador
   (en Chrome y Edge; en Firefox desmarca «Encabezados y pies» en el diálogo de impresión).
3. **Tarifa**: tarifa de precios sacada de todos los presupuestos (precio sugerido por artículo, en €/m² o por
   unidad). Fija tus precios, aplica un % general, quita lo que no quieras y descárgala en Excel o imprímela.
   El botón **Añadir** pasa un artículo de la tarifa al presupuesto; si va por m², el precio se calcula al poner
   las medidas.
4. **Facturas**: al importar se detecta si cada documento es factura, presupuesto o albarán (se puede corregir en
   la revisión). La pestaña Facturas muestra lo facturado por año y los artículos que se han cobrado de verdad. En
   el buscador y la tarifa los precios facturados llevan la etiqueta «facturado», y se puede filtrar por solo
   facturado o solo presupuestado.
5. **Partes de trabajo y firmas**: el cliente firma el albarán con el dedo en el móvil del técnico o desde un
   enlace que le llega por email; recibe la copia firmada en PDF. Estados (pendiente, firmado, no conforme),
   documentos firmados bloqueados, historial y rol de *operario* que solo ve los partes. Ver `deploy/GUIA-VPS.md`.
6. **Tema**: botón arriba a la derecha para elegir entre automático, claro y oscuro (textos blancos, detalles en
   naranja).
7. **Seguridad** (con servidor): verificación en dos pasos con app del móvil y códigos de recuperación, opcional u
   obligatoria para todos (Ajustes → Seguridad).

## Privacidad

- Este repositorio solo contiene el programa. **No subas aquí presupuestos ni datos de clientes.**
- Con servidor, los datos solo se leen con usuario y contraseña, y con **verificación en dos pasos** (TOTP)
  si se activa (sesión con cookie segura y bloqueo tras intentos fallidos). Sin servidor, no salen del navegador.

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
server/          servidor Node.js (sin dependencias): API, usuarios, verificación en dos pasos (mfa.js), SQLite
deploy/          instalación en el VPS (instalar.sh) y guía
js/ui/*.js       pantallas
vendor/          pdf.js y SheetJS (Apache 2.0) y qrcode-generator (MIT), incluidos para no depender de internet
```

