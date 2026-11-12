import { svgImageSource } from "../../lib/svg-image-source";

// Conserva la exportación pública existente del módulo del componente.
export { svgImageSource };

/** Mantiene el SVG generado en un documento de imagen, fuera del ámbito de
 * CSS e ID de la app. Es un límite de presentación, no un saneador para la
 * descarga del SVG original. */
export function SvgImage({
	svg,
	className,
	width,
}: {
	svg: string;
	className?: string;
	width?: number;
}) {
	// La fuente ya es una imagen vectorial en memoria; sin optimización de imágenes de Next.
	// eslint-disable-next-line @next/next/no-img-element
	return <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgImageSource(svg))}`} alt="Figure" className={className} width={width} draggable={false} />;
}
