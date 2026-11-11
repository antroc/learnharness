# Rich code blocks

Un plugin opcional del núcleo de LearnHarness que solo usa la API pública de plugins.
Convierte notación de más alto nivel en **SVG estático**:

| Ajuste, desactivado al principio | Bloque cercado | Contenido |
| --- | --- | --- |
| Chemical structures | `smiles` | Una molécula SMILES |
| Musical notation | `abc` | Una melodía ABC completa; sin audio |
| Technical diagrams | `tikz` | TikZ, CircuitikZ, tikz-cd y PGFPlots |

Activa el plugin en **Ajustes → Plugins del núcleo** y después activa solo las familias que
quieras en su página de Ajustes propia. Solo las familias activadas registran
renderizadores y añaden instrucciones de sistema breves a los agentes de sondeo, profesor y
práctica, incluida la fase de sondeo al principio de una sesión de enseñanza. Desactivar una
familia devuelve los bloques de código cercados normales y legibles. Los cambios en los
prompts se aplican a los turnos futuros, no a una petición al modelo que ya esté en curso. No
hay conmutadores por subárea, editores de prompts por familia, simulaciones, circuitos
interactivos, reproducción, entrada de SVG en bruto ni barras de herramientas de dibujo
personalizadas.

## Apariencia transparente

Los SVG renderizados no tienen fondo del plugin: se ve la transcripción a través de ellos.
El texto y las líneas neutros siguen el color de **Texto** de la app (`--foreground`),
incluidas las sustituciones del color de Texto, en las tres familias. Esto incluye la tinta
neutra de carbono e hidrógeno del renderizador de química. No hay un ajuste de color de tinta
aparte. Los átomos de color y los elementos de diagrama coloreados explícitamente siguen
teniendo color. Los rellenos blancos intencionados, los degradados y patrones escritos por
el autor y las máscaras funcionales se conservan, no se borran ni se invierten en bloque. Un
fondo dibujado a propósito dentro de un diagrama TikZ sigue formando parte de ese diagrama;
el plugin no adivina qué formas eliminar. No se usan modos de fusión ni filtros de inversión.

Los cambios de tema y de color de Texto llegan de inmediato a los SVG montados mediante
variables CSS heredadas, sin sustituirlos, volver a compilar TeX, vaciar la caché de SVG
compilados ni enviar peticiones de ajustes del plugin. Los montajes nuevos desde la caché
también heredan el color de Texto actual. Los ajustes v1 existentes se siguen pudiendo leer
con o sin la clave obsoleta `inkColor`; su valor se ignora. El arranque nunca reescribe el
fichero. El siguiente cambio de conmutador de familia guarda los ajustes sin esa clave
obsoleta, conservando las demás elecciones de familias.

## Tamaño de TikZ

Los diagramas TikZ se escalan en conjunto para que las etiquetas normales de 10 puntos del
motor coincidan con el tamaño del LaTeX del chat que las rodea (`1.21em`, igual que KaTeX).
Con el tamaño de lectura por defecto de 16 px, las etiquetas normales miden unos **19,4 px**.
El ancho del SVG relativo al texto sigue los cambios del tamaño de fuente circundante sin
sustituir el SVG ni recompilar TeX. Se conservan los tamaños de fuente relativos escritos por
el autor (incluidos los subíndices), las proporciones del diagrama y el viewBox ajustado
original. Los diagramas TikZ anchos hacen scroll horizontal dentro de su propio envoltorio en
lugar de encoger sus etiquetas. El envoltorio usa **12 px de relleno** y centrado, sin
márgenes extra ni espacio de dibujo en blanco. La química y la música usan su tamaño natural
y se ajustan al ancho.

## Plugin del núcleo y referencia de código

La app aporta y actualiza el código de este plugin; las preferencias escribibles viven en
`<learning data>/core-plugin-data/rich-code-blocks/`. Este proyecto de código es material de
referencia, no una copia instalable de la comunidad. `rich-code-blocks` es un ID reservado
del núcleo aunque esté desactivado o falte. Un fork de la comunidad necesita su propio ID de
manifiesto y carpeta y debe reconsiderar los nombres de contribuciones, herramientas y
bloques cercados en conflicto, incluidos `smiles`, `abc` y `tikz`. Un ID de plugin nuevo no
hace que coexistan registros duplicados de bloques cercados. No instales esta build en una
carpeta `plugins/rich-code-blocks/` de la comunidad.

## Desarrollo

En el kit de autoría extraído, copia el **contenido de `types/` de la raíz del kit**
compartido en `.sdk/` **antes de preparar las dependencias**. Desde
`plugins/rich-code-blocks/`:

```sh
mkdir -p .sdk
cp -R ../../types/. .sdk/
```

En cambio, en un checkout correspondiente del código de LearnHarness, `npm run sdk` genera
`.sdk/` usando `../../scripts/build-plugin-types.mjs`. Ese comando **solo funciona en un
checkout** y no funciona en el kit extraído. Las importaciones del SDK son solo de tipos; el
código de runtime no importa módulos de implementación del host.

Prepara aparte las dependencias de desarrollo, incluidas las dependencias peer y los tipos
declarados por el SDK. Con las dependencias ya disponibles, el comando que solo compila es:

```sh
npm run build
```

La salida de la build va directamente al **`dist/`** de este proyecto, no a `dist/<id>/`.
Empaqueta el JavaScript y TeX/WASM/fuentes locales y copia los avisos de licencia. La
limpieza rechaza un `dist/` enlazado simbólicamente y un `dist/data/` mal colocado y conserva
el `data/` hermano. Compilar no instala, activa ni actualiza el plugin del núcleo, no compila
ni reinicia el host y no activa ninguna familia de notación.

## Ejemplos

Estructura química:

````markdown
```smiles
CC(=O)Oc1ccccc1C(=O)O
```
````

Partitura musical:

````markdown
```abc
X:1
T:Scale
M:4/4
L:1/4
K:C
C D E F | G A B c |]
```
````

Los diagramas de física y de cuerpo libre y la geometría usan TikZ general:

````markdown
```tikz
\usepackage{tikz}
\begin{document}
\begin{tikzpicture}
  \draw (0,0) rectangle (1,1);
  \draw[->] (0.5,0.5) -- (0.5,2) node[above] {$N$};
  \draw[->] (0.5,0.5) -- (0.5,-1) node[below] {$mg$};
\end{tikzpicture}
\end{document}
```
````

Esquemas de circuitos (dibujo estático, **no simulación de circuitos**):

````markdown
```tikz
\usepackage{circuitikz}
\begin{document}
\begin{circuitikz}
  \draw (0,0) to[R=$R$] (3,0);
\end{circuitikz}
\end{document}
```
````

Diagramas conmutativos:

````markdown
```tikz
\usepackage{tikz-cd}
\begin{document}
\begin{tikzcd}
  A \arrow[r,"f"] & B
\end{tikzcd}
\end{document}
```
````

Gráficas de funciones analíticas:

````markdown
```tikz
\usepackage{pgfplots}
\pgfplotsset{compat=1.16}
\begin{document}
\begin{tikzpicture}
\begin{axis}[xlabel={$x$},ylabel={$f(x)$}]
  \addplot[domain=-2:2,samples=25]{x^2};
\end{axis}
\end{tikzpicture}
\end{document}
```
````

El motor incluido aporta una clase de documento standalone; no añadas `\documentclass` ni
`\documentstyle`. Cada bloque debe ser autocontenido: carga explícitamente los paquetes y
bibliotecas de TikZ que necesite antes de `\begin{document}` y cierra con `\end{document}`.
Los paquetes incluidos están disponibles, pero no se cargan automáticamente; las
declaraciones de otro bloque no se trasladan. En particular, carga `\usepackage{amsmath}`
para etiquetas matemáticas que usen `\text{...}` o ecuaciones alineadas. Coloca el entorno
del diagrama directamente dentro de `document`, sin un envoltorio exterior `\[...\]`,
`$$...$$` ni `equation`. Las etiquetas de nodos de TikZ pueden usar `$...$`; las celdas de
`tikzcd` ya usan modo matemático. La versión de PGFPlots incluida es la **1.16**: usa
`\pgfplotsset{compat=1.16}`, no `compat=1.18` ni una versión más nueva. Estos requisitos
también se incluyen en las instrucciones de sistema del sondeo, el profesor y la práctica
cuando los diagramas técnicos están activados. El proyecto original incluye además paquetes
de apoyo de matemáticas, arrays, 3D y chemfig, pero no son familias adicionales anunciadas.
Este plugin no ofrece ninguna vía de entrada de SVG, HTML o JS en bruto, shell, recursos
remotos, ficheros de datos subidos ni audio.

## Ciclos de vida, límites y seguridad

- Los bloques cercados incompletos y pendientes muestran el código sin compilar la entrada
  incompleta. Los errores y las violaciones de límites usan el recurso del host de error más
  código legible.
- TeX se ejecuta en un único Worker de navegador perezoso y en serie por ventana. Una tarea
  tiene un plazo de **10 segundos** (incluida la carga en frío), tras el cual se termina el
  Worker. La cancelación de un montaje activo también lo termina; las tareas en espera
  canceladas se eliminan. Las tareas siguientes lo vuelven a crear. Desactivar los diagramas
  técnicos o el plugin lo libera.
- Los límites del código son **2 KiB SMILES / 16 KiB ABC / 32 KiB TikZ**, medidos en UTF-8.
  El SVG generado está limitado a **2 MiB**; TeX admite como máximo **16 tareas en espera**.
  Una única LRU volátil guarda como máximo **32 salidas correctas / 8 MiB**, claves
  incluidas. No hay caché de render persistente ni peticiones de inferencia al modelo.
- La memoria lineal WASM fija de TeX es de unos **69 MiB**. No es un límite total de memoria
  del Worker: la conversión en JS, los recursos descomprimidos y las fuentes usan memoria
  adicional. El trabajo de CPU de TeX no puede congelar el bucle de eventos de la página,
  pero el navegador sigue consumiendo CPU y memoria. SMILES y ABC usan renderizadores
  basados en el DOM en el hilo principal con límites de código; **para ellos no se promete un
  plazo de ejecución estricto**.
- Todo el JS, TeX/WASM, recursos de paquetes y fuentes son recursos locales incluidos, que se
  cargan de forma perezosa. No se usa ninguna CDN, servicio ni URL arbitraria elegida por el
  documento.
- El SVG generado se analiza de forma inerte y después se **reconstruye** a partir de
  elementos y atributos estáticos revisados. Se descartan scripts, atributos de eventos,
  HTML, enlaces, animaciones, URL externas, reglas de hojas de estilo y CSS inseguro. Los ID
  y las referencias locales reciben un espacio de nombres por montaje. Se rechazan las
  referencias `use` locales cíclicas; el recuento memoizado del grafo aplica el mismo
  **límite de 2 MiB a la salida con los `use` expandidos** antes de montar, lo que impide
  cargas útiles pequeñas que amplifiquen referencias acíclicas. La admisión de texto,
  fuentes y estilos está restringida; solo se eligen las fuentes de TeX incluidas o familias
  normales del sistema. No insertes nunca HTML del modelo en bruto.
- Los dibujos renderizados son transparentes, con tinta neutra heredada del tema,
  conservando la proporción. La química y la música se ajustan al ancho disponible; el TikZ
  ancho hace scroll para conservar etiquetas del tamaño de las matemáticas. Las variables de
  pintado propias del plugin solo se aplican tras la sanitización y antes de la comprobación
  final del presupuesto de la salida expandida. Se conservan la luminancia de las máscaras y
  los colores y rellenos intencionados. No se monta ningún árbol generado en bruto ni
  listeners de interacción. La cancelación o liberación bloquea los resultados tardíos.
- Los ajustes tienen versión, se validan y se escriben de forma atómica en el
  `data/settings.json` propio del plugin. Solo se envía al backend el conmutador de familia
  que ha cambiado; se conservan los cambios no relacionados de otras ventanas concurrentes.
  Las revisiones aceptadas se sincronizan en vivo y las lecturas al reconectar no pueden
  sobrescribir una revisión aceptada más nueva. Los ajustes mal formados o más nuevos fallan
  de forma explícita sin reescribir el fichero. Desactivar nunca lo borra.

Sigue siendo código de plugin local de confianza, no un sandbox para plugins arbitrarios de
terceros. La sanitización de la salida estática y un Worker de TeX aislado no autorizan la
ejecución de JS arbitrario ni debilitan el aislamiento de Electron o del host.

## Pruebas y límites

Tras preparar el SDK y las dependencias, estas comprobaciones usan el proyecto del plugin, no
un checkout del host:

```sh
npm run typecheck
npm test
npm run build
npm run test:browser
```

Las pruebas unitarias cubren los contratos, los ajustes, el ciclo de vida, la caché y los
límites del Worker, incluidas las guardas de limpieza de la salida. El script de navegador
requiere Chrome/Chromium local (`CHROME_PATH` o una ruta por defecto admitida), los ficheros
`dist/` compilados y las dependencias de prueba del proyecto. Arranca una fixture de loopback
desechable y un perfil temporal de Chrome para probar las bibliotecas reales, la admisión de
SVG, el límite de tiempo y la cancelación, el tamaño de las fuentes, los cambios de tema en
vivo y desde la caché, los colores escritos por el autor y el alfa de las máscaras
rasterizadas. Una dependencia de KaTeX solo de desarrollo aporta las matemáticas de
referencia; su código y sus fuentes no se incluyen en la build del plugin.

La fixture simula el host; no arranca ni reinicia LearnHarness, no instala en un directorio
de datos real, no llama a ningún modelo ni establece la aceptación funcional de la app
empaquetada o por usuarios. Este proyecto no tiene script `test:native`. La integración real
con la app y el comportamiento específico de cada plataforma requieren comprobaciones aparte
del host.

## Ruta de lectura del código

- [`src/main.ts`](src/main.ts) y [`src/backend.ts`](src/backend.ts): sincronización de
  ajustes, registros condicionales de bloques cercados e instrucciones aditivas para los
  agentes.
- [`src/contract.ts`](src/contract.ts): política de familias, límites de código, salida y
  caché y ajustes validados.
- [`src/render.ts`](src/render.ts) → [`src/tex-runner.ts`](src/tex-runner.ts) →
  [`src/tex-worker.ts`](src/tex-worker.ts): renderizado perezoso, trabajo en serie,
  cancelación y ciclo de vida del Worker.
- [`src/svg.ts`](src/svg.ts) y [`src/appearance.ts`](src/appearance.ts): admisión de SVG
  estático, tratamiento de referencias locales y pintado y tamaño conscientes del tema.
- [`scripts/build.mjs`](scripts/build.mjs), [`licenses/`](licenses/) y
  [`tests/`](tests/): recursos locales, adaptaciones del proyecto original, avisos y
  fixtures.

Consulta el [mapa de ejemplos](../../docs/plugin-examples.md), la
[guía de autoría](../../docs/plugin-authoring.md) y la
[referencia de la API](../../docs/plugin-api/README.md).

## Licencia

AGPL-3.0-only. Consulta [`LICENSE`](LICENSE), [`THIRD-PARTY.md`](THIRD-PARTY.md) y
[`licenses/`](licenses/) para las bibliotecas fijadas, las adaptaciones para navegador
estático y las licencias y avisos del proyecto original. La build conserva los textos
completos de GPLv3 y Apache-2.0 y los avisos pertinentes de PyDvi y ColorBrewer junto a las
demás licencias del proyecto original.
