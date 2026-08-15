import { statelessApi } from "../../../src/server/api/handlers";

export const dynamic = "force-dynamic";
export const maxDuration = 75;

export function POST(request: Request): Promise<Response> {
  return statelessApi.synthesize(request);
}
