import { createPluginDocumentRoute, pluginTransport } from "@/src/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Esta ruta exacta se salta la clonación del cuerpo en Proxy, NO la autenticación de escritorio.
const handlers = createPluginDocumentRoute(pluginTransport);
export const POST = handlers.POST;
export const OPTIONS = handlers.OPTIONS;
export const GET = handlers.GET;
export const HEAD = handlers.HEAD;
export const PUT = handlers.PUT;
export const PATCH = handlers.PATCH;
export const DELETE = handlers.DELETE;
