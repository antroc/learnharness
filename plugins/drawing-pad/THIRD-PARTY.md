# Atribución y licencias

## Contribución de escritura a mano (mecánicas adaptadas)

Los trazos sensibles a la presión, el borrado de trazos completos por distancia al segmento,
el historial de deshacer, la gestión del puntero de ratón/lápiz y la composición del fondo
congelado están adaptados de:

- Repositorio: https://github.com/hrdkj/learnharness
- Rama: `codex/handwriting-contribution`
- Commit revisado: `48dd022`
- Ficheros: `src/core/question-writing.ts`, `components/question-writing.tsx`,
  `components/question-writing-capture.ts`
- Licencia: AGPL-3.0-only, la misma licencia que LearnHarness y este plugin.

Es código propiedad del plugin que usa capacidades públicas del host, no una copia de la
integración privada en la interfaz nativa de la contribución. El plugin añade el ciclo de
vida por sesión, los ajustes, la interceptación del envío y el comportamiento de
aceptación/restablecimiento propio de la práctica.

## html-to-image 1.11.13

https://github.com/bubkoo/html-to-image

Con licencia MIT. Se incluye únicamente para capturar el DOM de referencia renderizado
propiedad del plugin; la licencia del paquete se copia en `dist/licenses/html-to-image-LICENSE`
durante la compilación.
