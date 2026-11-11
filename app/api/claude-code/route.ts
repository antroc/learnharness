import { claudeCodeInstallationResponse } from "@/src/server";

/** Solo instalación/versión; nunca lee el estado de autenticación ni hace una petición al modelo. */
export async function GET(request: Request) {
	return claudeCodeInstallationResponse(request);
}
