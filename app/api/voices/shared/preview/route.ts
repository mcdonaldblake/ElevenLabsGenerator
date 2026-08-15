import { statelessApi } from "../../../../../src/server/api/handlers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET(request: Request): Promise<Response> {
  return statelessApi.previewSharedVoice(request);
}
