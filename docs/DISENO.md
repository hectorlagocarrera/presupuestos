# Diseño de la aplicación de presupuestos

Objetivo: **encontrar en segundos trabajos ya presupuestados, comparar sus precios y reutilizarlos** para
hacer presupuestos nuevos. Lo que se busca es el trabajo (artículo, material, medidas, descripción). El cliente
es un dato secundario.

---

## 1. Arquitectura

```
┌──────────────────────── Navegador del ordenador de la oficina ────────────────────────┐
│                                                                                          │
│  Interfaz (HTML + JS)                                                                    │
│   Nuevo presupuesto · Buscador · Artículos · Presupuestos · Clientes · Importar · Ajustes │
│        │                         │                                  │                    │
│        ▼                         ▼                                  ▼                    │
│  Motor de búsqueda          Importadores                       Impresión / PDF           │
│  (sinónimos, medidas,       PDF (pdf.js) · Excel/CSV/ODS                                  │
│   puntuación, estadísticas)  (SheetJS) · texto pegado                                    │
│        │                         │                                                       │
│        └──────────┬──────────────┘                                                       │
│                   ▼                                                                      │
│      Base de datos local (IndexedDB): presupuestos, partidas, clientes, archivos, ajustes  │
│                                                                                          │
└──────────────────────────────────────────────────────────────────────────────────────────┘
          ▲  Solo se descarga el programa (GitHub Pages). Los datos nunca salen del equipo.
```

- **Aplicación web sin servidor.** Es una página que se abre en el navegador (Chrome o Edge), sin instalar nada.
  GitHub Pages solo sirve el programa. Los datos no se suben a ninguna parte.
- **Base de datos local (IndexedDB) en el navegador.** Aguanta decenas de miles de partidas y la búsqueda es
  instantánea, porque todo está en memoria.
- **Librerías incluidas en el propio repositorio** (`vendor/`): pdf.js para leer PDF y SheetJS para Excel. No se
  carga código de terceros desde internet.
- **Privacidad.** Una política de seguridad (CSP) prohíbe a la página conectarse a cualquier servidor que no sea
  el suyo. Ni presupuestos ni clientes pueden enviarse fuera aunque hubiera un fallo. El repositorio solo contiene
  código: **nunca se guardan datos de la empresa en GitHub.**
- **Copias de seguridad.** Se exporta un archivo `.json`, con los PDF originales si se quiere, para guardarlo o
  llevarlo a otro ordenador.

**Fase 2 (opcional)**, si varias personas tienen que compartir la base de datos al mismo tiempo: un servidor
privado con usuario y contraseña (por ejemplo Supabase o un pequeño servidor en la oficina) con las mismas tablas.
El diseño de datos de abajo ya está pensado para pasar a una base de datos SQL sin cambios.

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
7. **Ajustes.** Datos de la empresa, IVA y diccionario de sinónimos (editable).

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
   - y así para metacrilato, letras corpóreas, rotulación de vehículos, señalética, montaje, instalación, diseño…

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

Los resultados se ordenan por puntuación. Con los más parecidos se calculan:
**último precio, precio medio, mínimo, máximo, €/m² (medio, mínimo, máximo) y evolución por año**
(por ejemplo 2024: 480 € → 2025: 520 € → 2026: 545 €, +13,5 %). Si la búsqueda lleva medidas, también se muestra
el **precio orientativo** que saldría con el €/m² habitual. Es solo una referencia: el precio final lo decide la
persona.

Filtros: categoría, año (escribir «2025» en la búsqueda también filtra) y precio mínimo/máximo.

## 6. Importación de PDF y Excel

**PDF con texto** (los que salen de Word, Excel o un programa de facturación):
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
- Base de datos compartida entre varios ordenadores (servidor privado con usuarios).
- Plantillas de impresión personalizadas con logotipo.
