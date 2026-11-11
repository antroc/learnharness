/** El único endpoint personalizado del PR #62: conexión por descubrimiento/manual, fijaciones
 * sin conexión y desconexión. Los límites del host y las mutaciones viven tras el barril del servidor. */
import { customProviderGet, customProviderMutation } from "@/src/server";

export const dynamic = "force-dynamic";
export const GET = customProviderGet;
export const POST = customProviderMutation;
export const PATCH = customProviderMutation;
export const DELETE = customProviderMutation;
