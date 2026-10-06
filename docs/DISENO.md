# Diseño de la aplicación de presupuestos

Objetivo: **encontrar en segundos trabajos ya presupuestados, comparar sus precios y reutilizarlos** para
hacer presupuestos nuevos. Lo que se busca es el trabajo (artículo, material, medidas, descripción). El cliente
es un dato secundario.

---

## 1. Arquitectura

```
 Ordenadores de la oficina (Chrome / Edge)                      VPS de OVH (Ubuntu)
┌────────────────────────────────────────┐         ┌──────────────────────────────────────────────┐
│ Interfaz (HTML + JS)                    │  HTTPS  │ nginx  ── archivos de la web                  │
│  pantallas · buscador inteligente ·     │ ──────► │   └─ /api ──► servidor Node.js (usuarios,     │
│  importadores PDF/Excel · impresión     │         │               sesiones, API)                  │
│ Copia de los datos en memoria           │ ◄────── │                 └─ SQLite /var/lib/…/datos.db │
│ (búsquedas al instante)                 │         │ copia diaria → /var/backups/presupuestos      │
└────────────────────────────────────────┘         └──────────────────────────────────────────────┘
```

- **Servidor propio en el VPS**: Node.js 22 sin dependencias externas. Usa la base de datos **SQLite** que trae
  Node (`node:sqlite`). nginx sirve la web con HTTPS (Let's Encrypt) y reenvía `/api` al servidor.
- **Base de datos compartida**: todos los ordenadores trabajan sobre los mismos datos. Al abrir la app se cargan
  enteros en memoria (unos 2 MB para 1.600 presupuestos), así que buscar es instantáneo. Cada cambio se guarda en
  el servidor en una transacción; las importaciones grandes van en un solo envío. Al volver a la pestaña se
  recargan los cambios de otros ordenadores.
- **Verificación en dos pasos (TOTP, RFC 6238)**: opcional u obligatoria para todos. Admite ±30 s de desfase y no
  acepta dos veces el mismo código. Incluye 10 códigos de recuperación de un solo uso (se guarda solo su huella
  SHA-256). Al activarla se cierran las demás sesiones del usuario. Si es obligatoria y el usuario no la tiene, el
  servidor solo le deja configurarla.
- **Acceso con usuario y contraseña**: contraseñas con scrypt, sesión en una cookie HttpOnly, SameSite=Strict y
  Secure de 30 días, bloqueo tras 8 intentos fallidos, y cabecera anti-CSRF en las escrituras.
- **Lectura de PDF y Excel en el navegador** (pdf.js y SheetJS incluidos en `vendor/`). Al servidor solo llegan
  los datos ya extraídos y el archivo original.
- **Privacidad**: una política de seguridad (CSP) impide a la página conectarse a otros servidores. El
  repositorio solo contiene código: **nunca se guardan datos de la empresa en GitHub.**
- **Copias**: copia diaria de la base de datos en el VPS (30 días), más la copia `.json` descargable desde la app.
- **Modo sin servidor**: si la página se abre sin servidor (por ejemplo en GitHub Pages), guarda los datos en el
  navegador (IndexedDB) con las mismas pantallas.

## 2. Base de datos

```
presupuestos                     partidas (lo que se busca)            clientes
─────────────────                ───────────────────────────           ───────────────
id                               id                                    id
numero        "2025-014"         presupuestoId  → presupuestos.id      nombre
fecha         2025-03-12         orden                                 cif
clienteId     → clientes.id      articulo       "Cartel Alupanel"      direccion
clienteNombre                    categoria      "Alupanel"             telefono
iva           21                 descripcion    texto libre            email
notas                            material       "Alupanel 3 mm"        notas
origen        app | importado    acabados
archivoId     → archivos.id      montaje                               archivos
base, total   (calculados)       ancho, alto    en metros              ───────────────
creado, modificado               m2             ancho × alto           id, nombre, tipo,
                                 cantidad                              blob (PDF/Excel original)
                                 precioUnitario
                                 precioTotal                           ajustes
                                 precioM2       precioUnitario / m2    ───────────────
                                 observaciones                         empresa, IVA,
                                 fecha, cliente, numero  (copias       sinónimos, numeración
                                                del presupuesto)
                                 revisar        true si la importación
                                                no fue segura
```

- Cada línea de un presupuesto (antiguo o nuevo) es una **partida**, y las búsquedas se hacen sobre ellas.
- Cada partida lleva una copia de la fecha, el cliente y el número para mostrar los resultados sin más consultas.
- La superficie y el precio por m² se recalculan siempre a partir de ancho, alto y precio.

## 3. Pantallas

1. **Nuevo presupuesto** (pantalla principal). A la izquierda está el presupuesto que se está haciendo: cliente,
   nº, fecha y partidas con artículo, categoría, material, medidas, cantidad, precio, €/m², acabados, montaje y
   observaciones, más los totales. A la derecha aparecen las **referencias históricas**, buscadas solas según lo
   que se escribe en la partida activa, con las estadísticas de precio. Cada resultado tiene **«Usar como
   referencia»** y también se puede **arrastrar** al presupuesto.
2. **Buscador histórico.** Un buscador grande con filtros por categoría, año y precio. Muestra la comparación de
   precios (último, medio, mínimo, máximo, €/m², evolución por año) y la lista de trabajos parecidos.
3. **Artículos / trabajos.** Tabla con todas las partidas para revisar y corregir las importadas. Las que no se
   leyeron con seguridad salen marcadas como «Revisar».
4. **Presupuestos anteriores.** Lista por año (2024, 2025, 2026…). Desde ahí se abre, duplica, imprime o borra un
   presupuesto, y se ve el PDF o Excel original.
5. **Clientes.** Datos para el encabezado del presupuesto. Se crean solos al guardar.
6. **Importar.** PDF, Excel, CSV, ODS o texto pegado, con pantalla de revisión antes de guardar. Aquí está también
   la copia de seguridad.
7. **Tarifa de precios.** Agrupa las partidas de todos los presupuestos en artículos (categoría + las 3 primeras
   palabras que los describen, sin colores, tallas ni medidas). El precio sugerido es la mediana de los 10 usos
   más recientes: en €/m² si la mayoría lleva medidas y las piezas son grandes (de media ≥ 0,25 m²), y por
   unidad en el resto (textil, imprenta, pegatinas…). Cada precio se puede fijar a mano, se puede aplicar un
   ajuste general en % y quitar artículos. Sale en Excel o impresa con el logo.
8. **Ajustes.** Datos de la empresa, IVA y diccionario de sinónimos (editable).

## 4. Flujo de trabajo

```
Importar histórico ──► Revisar partidas detectadas ──► Guardar ──► Base de datos de partidas
                                                                         ▲          │
                                                                         │          ▼
Nuevo presupuesto: escribir «Alupanel 3x2» ──► referencias similares + estadísticas de precio
       │                                              │
       │◄──────── «Usar como referencia» / arrastrar ─┘
       ▼
Ajustar medidas, cantidad y precio (decide la persona) ──► Guardar ──► pasa al histórico
       │
       └──► Imprimir / Guardar como PDF · Duplicar · Editar más tarde
```

## 5. Búsqueda inteligente

Cada partida se convierte en una ficha de búsqueda que tiene:

1. **Palabras normalizadas**: en minúsculas, sin acentos, sin palabras vacías («de», «con», «para»…) y en
   singular («carteles» → «cartel»).
2. **Conceptos.** Un diccionario de sinónimos agrupa términos distintos bajo el mismo concepto:
   - Alupanel = panel composite = Dibond = panel (de) aluminio = cartel (de) aluminio = aluminio compuesto…
   - PVC = Forex = PVC espumado… · Vinilo = adhesivo = pegatina… · Lona = pancarta = banner…
   - y así para metacrilato, polipropileno, letras corpóreas, rotulación de vehículos, señalética, textil
     (camisetas, sudaderas, serigrafía en tetilla o espalda…), imprenta (tarjetas, flyers, calendarios…),
     merchandising, sellos, carpas y banderas, montaje, instalación y diseño, con el vocabulario de los históricos.
   - Un término que incluye el nombre del concepto («vinilo ácido») es un **tipo** y no un sinónimo: buscar
     «vinilo ácido» no da por buena cualquier partida de vinilo.

   El diccionario se edita en Ajustes con el vocabulario de la empresa.
3. **Medidas** leídas del texto o de los campos ancho y alto: «3x2», «3 x 2 m», «300x200 cm», «3000 x 2000 mm» o
   «1,5 x 0,8» se pasan todas a metros. Si no se indica la unidad, se deduce por el tamaño del número.

Para una búsqueda como «Alupanel 3x2», cada partida recibe una puntuación de 0 a 100:

| Parte | Peso | Cómo se calcula |
|---|---|---|
| Concepto | ~30 | Comparte concepto con la búsqueda (Alupanel ≈ Dibond) |
| Texto | ~40 | Palabras iguales (100 %), sinónimos (90 %), que empiezan igual (85 %) o con una errata (70 %, p. ej. «alupanell») |
| Medidas | 30 | Parecido de ancho, alto y superficie. Da igual el orden: 3x2 = 2x3. Un 3x1,5 puntúa menos que un 3x2 |
| Antigüedad | +3 | Desempate a favor de los más recientes |

Los resultados se ordenan por puntuación y se descartan los que quedan muy lejos del mejor. Con los más
parecidos (y, si se buscó una medida, los de tamaño parecido) se calculan:
**último precio, precio medio, mínimo, máximo, €/m² habitual (la mediana, que no se deja engañar por casos raros),
mínimo y máximo, y evolución por año**
(por ejemplo 2024: 480 € → 2025: 520 € → 2026: 545 €, +13,5 %). Si la búsqueda lleva medidas, también se muestra
el **precio orientativo** que saldría con el €/m² habitual. Es solo una referencia: el precio final lo decide la
persona.

Filtros: categoría, año (escribir «2025» en la búsqueda también filtra) y precio mínimo/máximo.

## 6. Importación de PDF y Excel

**PDF del programa de gestión de la empresa** (columnas *Cantidad · Código · Artículo · Precio · Dto. · IVA ·
Subtotal*; un mismo PDF puede contener cientos de presupuestos). Hay un lector a medida (`js/columnas.js`) que usa la
posición de cada texto en la página:
1. Separa los presupuestos por «Página 1 / N» y une las páginas de continuación con su presupuesto.
2. Lee el nº y la fecha bajo «Número / Fecha», el cliente del recuadro de la derecha (nombre, dirección y CIF) y
   los totales del pie (base imponible y total).
3. Cada fila con cantidad o precio es una partida. Las líneas de debajo forman su descripción, y lo que va tras una
   línea en blanco se guarda como observaciones. Si la descripción va encima de una fila «SUBTOTAL», se le asigna a
   esa fila. Con descuento (Dto.), se guarda el precio neto y se anota el de tarifa.
4. Las piezas indicadas en el texto («17 ALUCABONES de 1800x400») se tienen en cuenta para el €/m². En piezas muy
   pequeñas (tarjetas, pegatinas) no se calcula el €/m².
5. Al importar se saltan los presupuestos que ya estaban (mismo nº y fecha). Los datos de la empresa se toman del
   presupuesto más reciente.

Probado con los históricos 2024–2026: 1.616 presupuestos y 3.013 partidas en unos 7 segundos. Todos salieron con
nº y fecha, y la suma de partidas coincide con la base imponible en el 99 % (el resto son presupuestos con
opciones alternativas).

**Otros PDF con texto** (Word, Excel, otros programas):
1. pdf.js extrae el texto con su posición y lo reconstruye en líneas.
2. Se buscan el **nº de presupuesto**, la **fecha** y el **cliente** con patrones habituales («Presupuesto nº»,
   «Fecha:», «Cliente:»).
3. Se localiza la tabla de partidas: una línea con descripción y números al final (cantidad, precio, importe).
   Se comprueba que **cantidad × precio ≈ importe**. Las líneas de texto sin números que van debajo se unen a la
   descripción de la partida anterior. Las líneas de base imponible, IVA y total se descartan.
4. Cada partida se completa sola: medidas → ancho, alto y m²; sinónimos → categoría y material.
5. Si algo no cuadra, la partida se marca **«Revisar»**. Todo se enseña en una pantalla editable antes de guardar,
   y el PDF original queda adjunto al presupuesto.

**Excel / CSV / ODS:**
- Se busca la fila de cabecera (Descripción, Cantidad, Precio, Importe, Ancho, Alto, Medidas, Material…) y se
  asigna cada columna a su campo.
- Si el Excel tiene columnas de **fecha**, **nº de presupuesto** o **cliente**, se trata como un **listado
  histórico**: cada grupo de filas con el mismo nº se convierte en un presupuesto. Es lo más rápido si ya existe un
  Excel con todo.
- Si no hay cabecera reconocible, se lee como texto con el mismo método que los PDF.

**PDF escaneados** (fotos): no tienen texto. En el MVP se pasan a mano. En la fase 2 se puede añadir un
reconocimiento de texto (OCR) dentro del navegador.

**Texto pegado:** sirve para cualquier otro formato (Word, correo…): se copia, se pega y se procesa igual.

## 7. MVP (primera versión)

Entra en esta versión:

- [x] Las 7 pantallas descritas, con el diseño de dos zonas en «Nuevo presupuesto».
- [x] Base de datos local privada, sin servidor, con copia de seguridad.
- [x] Búsqueda inteligente con sinónimos editables, medidas, erratas y filtros.
- [x] Comparación de precios: último, medio, mínimo, máximo, €/m² y evolución por año.
- [x] «Usar como referencia» y arrastrar partidas al presupuesto.
- [x] Cálculo automático de m², €/m² y totales con IVA. Al escribir el €/m² se calcula el precio.
- [x] Importación de PDF con texto, Excel, CSV, ODS y texto pegado, con revisión manual.
- [x] Guardar, editar, duplicar, imprimir y guardar como PDF. Lo guardado pasa al histórico al momento.

Se deja para más adelante:

- OCR de PDF escaneados.
- Plantillas de impresión personalizadas con logotipo.
