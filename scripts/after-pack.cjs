// Hook afterPack de electron-builder; solo mac.
//
// POR QUÉ (decisión del responsable 2026-10-13): mac.icon es el documento de Icon Composer
// (build/icon.icon); actool lo compila a Assets.car (el render Liquid Glass de
// macOS 26) MÁS un icns de compatibilidad hacia atrás, pero el icns alternativo de
// actool tiene un tope de 256px (comportamiento conocido de actool), que se ve borroso
// en los tamaños de Finder/Launchpad en los macOS anteriores a Tahoe. Este hook pone en su lugar el
// build/icon.icns de resolución completa empaquetado a mano (las 10 entradas, 16→1024, empaquetadas
// con iconutil a partir de los PNG exportados del diseño) DESPUÉS de empaquetar y ANTES de
// firmar, así que:
//
//   macOS 26+   → Assets.car (CFBundleIconName): el verdadero icono de cristal por capas;
//   mac antiguo → icon.icns (CFBundleIconFile): el aplanado actual a resolución completa.
//
// Las compilaciones de Windows/Linux vuelven de inmediato (sus iconos son ficheros estáticos:
// build/icon.ico / build/icon.png).
const fs = require("node:fs");
const path = require("node:path");

module.exports = async function afterPack(context) {
	if (context.electronPlatformName !== "darwin") return;
	const appBundle = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
	const target = path.join(appBundle, "Contents", "Resources", "icon.icns");
	const source = path.join(context.packager.info.projectDir, "build", "icon.icns");
	fs.copyFileSync(source, target);
	console.log(`[after-pack] pre-Tahoe fallback icns (full-res) → ${target}`);
};
