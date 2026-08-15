import { statelessApi } from "../../../../../../../src/server/api/handlers";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ publicOwnerId: string; voiceId: string }>;
};

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return statelessApi.addSharedVoice(request, await context.params);
}
