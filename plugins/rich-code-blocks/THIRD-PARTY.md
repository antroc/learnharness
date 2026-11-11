# Software de terceros incluido

Rich code blocks tiene licencia AGPL-3.0-only (ver LICENSE). Las licencias de las dependencias
se conservan en el directorio `licenses/` de la distribución compilada; la licencia de BaKoMa
también se conserva junto a las fuentes tipográficas. No hay instalaciones npm en tiempo de
ejecución ni recursos de CDN externos.

Dependencias principales de renderizado:

- **smiles-drawer 2.4.1** — MIT, Daniel Probst / Reymond Group, University of Berne.
  https://github.com/reymond-group/smilesDrawer
- **abcjs 6.7.2** — MIT, Paul Rosen and Gregory Dyke and contributors.
  https://github.com/paulrosen/abcjs
- **isomorphic-tikzjax 0.1.1** — LPPL-1.3c, prin and upstream TikZJax contributors.
  https://github.com/prinsss/node-tikzjax
- **@prinsss/dvi2html 0.0.1** — avisos de origen mixtos: los metadatos del paquete indican
  GPL-3.0; su implementación TFM de PyDvi incluida lleva avisos GPL-3.0-or-later
  (Copyright 2014 Fabrice Salvaire). El LICENSE raíz del paquete es un aviso MIT aparte,
  Copyright 2015 Mitch Anderson. Se conservan tanto ese texto MIT como el texto completo de
  la GPLv3 y el aviso de PyDvi; el fichero MIT no cubre las partes GPL.
  https://github.com/prinsss/dvi2html
- **BaKoMa fonts** — BaKoMa Fonts Licence, Basil K. Malyshev.

La distribución de isomorphic-tikzjax aporta la imagen TeX/WASM incluida, el archivo de
paquetes y las fuentes tipográficas. El proyecto de origen da crédito a TikZJax / kisonecat y
a la compilación `output-single-file` de artisticat1. La imagen y el archivo originales se
copian sin cambios.

Otras dependencias JavaScript incluidas (las versiones están fijadas en package-lock.json):
chroma-js (BSD-3-Clause AND Apache-2.0, incluido material de ColorBrewer de Cynthia
Brewer, Mark Harrower and The Pennsylvania State University), buffer (MIT), base64-js (MIT), ieee754 (BSD-3-Clause),
md5 (BSD-3-Clause), charenc (BSD-3-Clause), crypt (BSD-3-Clause), is-buffer (MIT)
y pako (MIT/Zlib). Sus avisos de origen se copian en `licenses/`, junto con el texto
completo de Apache-2.0 para ColorBrewer (no solo la URL de su licencia).

## Adaptaciones explícitas para navegador estático

La compilación elimina de su módulo ES fijado las exportaciones globales
`window.SmilesDrawer` / `window.SmiDrawer` de smiles-drawer, que no se usan. Se usa
directamente la exportación del módulo; la dependencia original en disco no cambia y se
comprueba el parche exacto.

La compilación incluye solo la entrada visual de abcjs, `src/api/abc_tunebook_svg.js`, en
lugar de las API de audio/sintetizador/editor. Omite los dos listeners de nivel superior de
ese módulo para el redimensionado/orientación del viewport; el plugin nunca usa su modo de
viewport. La compilación comprueba la sustitución exacta sobre el código fuente fijado, para
que una actualización no pueda conservar en silencio esos efectos secundarios globales
independientes de la activación. La dependencia en disco no se modifica. Los listeners de
interacción por partitura se descartan con el árbol de renderizado desconectado: solo entra en
la aplicación el SVG estático reconstruido.

En la compilación del Worker de TeX, las importaciones dinámicas de `jsdom` y `svgo`, que
solo existen en Node, se resuelven a stubs explícitos que lanzan una excepción. El Worker
llama a `dvi2svg` con `disableSanitize: true`, lo que evita esas rutas. Esa opción de origen
se salta el análisis del DOM, **no es un saneador de seguridad**. El plugin aplica su propia
reconstrucción estricta de SVG estático antes de mostrar nada. `node:buffer` se resuelve a la
implementación de Buffer para navegador incluida. En el Worker no se incluye ninguna
implementación del sistema de ficheros de Node.

El CSS de las fuentes tipográficas usa el espacio de nombres `rich-code-blocks-font-*`, que
coincide con los atributos de fuente SVG admitidos, y solo usa ficheros de fuentes relativos
incluidos. El SVG generado nunca importa una hoja de estilos ni proporciona una URL externa.
El fragmento de SVG único en bruto del escritor DVI fijado omite su etiqueta de cierre raíz
final (que normalmente repara su parser HTML). El Worker cierra solo ese fragmento conocido
con una raíz y sin etiqueta de cierre antes del saneado XML estricto; nunca analiza HTML
generado. Una adaptación aparte del DVI, con el código fuente comprobado, escapa los
caracteres de texto normales `&`, `<` y `>` cuando se emiten, conservando las entidades
numéricas intencionadas. Así, las etiquetas TeX válidas como `A\\&B` y `$x<y$` siguen siendo
XML válido en lugar de confundirse con marcado. El SVG de SMILES/ABC producido por el
navegador se serializa con XMLSerializer para conservar su espacio de nombres SVG. Las
transformaciones CSS translate de las etiquetas de SMILES se convierten en matrices SVG 2D
finitas validadas; solo sobreviven las declaraciones estáticas aprobadas. Los textos de las
licencias de los proveedores no se modifican. Unas declaraciones de TypeScript acotadas cubren
solo las llamadas a los proveedores que se usan aquí: el paquete SMILES fijado tiene
referencias Vertex colgantes en sus declaraciones, y las declaraciones por defecto del paquete
TikZ describen la entrada de Node.
