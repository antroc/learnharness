# Temas

**Ajustes → Apariencia → Tema** establece la paleta de la interfaz de la aplicación.
LearnHarness incluye once preajustes: Default (la paleta oscura original), Catppuccin
Latte, Frappé, Macchiato y Mocha, Rosé Pine y Rosé Pine Dawn, Gruvbox Dark, Ivory, Pastel y NvChad Onedark.
Cada tema declara si es oscuro o claro. El fondo de la ventana nativa
sigue el fondo efectivo, incluida tu personalización; los símbolos de los controles nativos
eligen una tinta que contraste. Los diagramas Mermaid siguen el modo claro/oscuro del tema.
Las figuras generadas conservan sus propios colores y los controles de inversión existentes. Los plugins
que usan los tokens CSS de la aplicación los heredan; las paletas y las ilustraciones propias de cada plugin
no se reescriben.

## Personalizar colores sueltos

El bloque **Colores**, bajo la cuadrícula de temas, tiene un campo por cada color del tema. Un campo
relleno prevalece sobre el tema activo; un campo vacío usa el valor del tema, que se muestra en
su pista. Las personalizaciones se conservan al cambiar de tema, de modo que un fondo que te guste
sobrevive a un cambio de paleta. **Restablecer todo** borra todas las personalizaciones.

`background`, `bold` e `italic` conservan sus claves de ajustes anteriores a los temas
(`appearance.background`, `mdRendering.boldColor`, `mdRendering.italicColor`), así que
los valores establecidos en versiones anteriores siguen funcionando.

## Ficheros de tema

**Exportar JSON** descarga el tema activo con tus personalizaciones aplicadas. Importar
de nuevo ese fichero reproduce lo que se ve en pantalla. **Importar JSON** acepta un fichero con esta
forma:

```json
{
	"name": "My Theme",
	"mode": "dark",
	"colors": {
		"background": "#1e1e2e",
		"surface": "#313244",
		"border": "#45475a",
		"text": "#cdd6f4",
		"textMuted": "#a6adc8",
		"accent": "#cba6f7",
		"bold": "#b4befe",
		"italic": "#f5c2e7",
		"code": "#fab387",
		"error": "#f38ba8",
		"success": "#a6e3a1",
		"warning": "#f9e2af"
	}
}
```

Los doce colores son obligatorios, en hexadecimal `#rgb` o `#rrggbb`. `mode` es `"dark"` o
`"light"`. Un fichero al que le falte una clave o que tenga una clave no válida se rechaza, y el error indica
cuál es.

| Clave | Dónde se ve |
|---|---|
| `background` | Fondo de la página |
| `surface` | Tarjetas, popovers, campos de entrada; los estados hover se derivan de él |
| `border` | Bordes y contornos de los campos |
| `text` | Texto principal |
| `textMuted` | Texto secundario y pistas |
| `accent` | Anillos de foco, interruptores, la tarjeta del tema seleccionado |
| `bold` | Texto en **negrita** de las lecciones |
| `italic` | Texto en *cursiva* de las lecciones |
| `code` | `code` en línea de las lecciones |
| `error` | Errores, respuestas incorrectas, acciones destructivas |
| `success` | Respuestas correctas, estados conectados |
| `warning` | Avisos y estados parciales |

## Dónde se guardan los temas personalizados

Los temas importados se guardan como `<id>.json` en la carpeta `themes/` del directorio de datos
de la aplicación (`data/themes/` en una copia de desarrollo, o en `userData` de Electron
en la aplicación de escritorio). El id es un slug del nombre; un nombre que coincida con un
tema existente recibe un sufijo `-2`, `-3`… Los ids de los preajustes están reservados.

Eliminar el tema personalizado activo vuelve a Default y conserva tus personalizaciones.
Si el fichero seleccionado se elimina o deja de ser válido fuera de la aplicación, la interfaz vuelve
a Default; el siguiente guardado de apariencia también repara la selección guardada, así que
la fuente y los demás cambios de apariencia siguen disponibles.
