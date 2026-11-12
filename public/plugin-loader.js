// Se sirve a propósito como módulo nativo del navegador, fuera del paquete de Next.
// Los plugins son código local de confianza, no módulos aislados.
window.__lhImportPlugin = (url) => import(url);
