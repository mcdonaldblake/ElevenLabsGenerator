import {
  accountVoiceQuerySchema,
  addSharedVoiceBodySchema,
  previewQuerySchema,
  sharedVoicePathSchema,
  sharedVoiceQuerySchema,
  speechBodySchema,
} from "./contracts";
import {
  RESPONSE_SECURITY_HEADERS,
  assertSameOrigin,
  jsonResponse,
  parseJson,
  parseQuery,
  safelyHandle,
} from "./http";
import { getVoiceProvider } from "../elevenlabs/provider";
import type { AudioStream, VoiceProvider } from "../elevenlabs/types";

export type StatelessApiDependencies = {
  getProvider: () => VoiceProvider;
};

function audioResponse(audio: AudioStream, options: { fileName?: string; varyRange?: boolean } = {}): Response {
  const headers = new Headers(RESPONSE_SECURITY_HEADERS);
  headers.set("content-type", audio.mimeType);
  if (audio.contentLength != null) headers.set("content-length", String(audio.contentLength));
  if (audio.acceptRanges) headers.set("accept-ranges", audio.acceptRanges);
  if (audio.contentRange) headers.set("content-range", audio.contentRange);
  if (audio.providerRequestId) headers.set("x-provider-request-id", audio.providerRequestId);
  if (audio.characterCost != null) headers.set("x-voice-lab-character-cost", String(audio.characterCost));
  if (options.fileName) headers.set("content-disposition", `inline; filename="${options.fileName}"`);
  if (options.varyRange) headers.set("vary", "Range");
  return new Response(audio.stream, { status: audio.status, headers });
}

function downloadName(mimeType: string): string {
  if (mimeType === "audio/mpeg") return "voice-lab.mp3";
  if (mimeType === "audio/wav") return "voice-lab.wav";
  if (mimeType === "audio/ogg") return "voice-lab.ogg";
  return "voice-lab-audio";
}

export function createStatelessApi(dependencies: StatelessApiDependencies) {
  return {
    listAccountVoices(request: Request): Promise<Response> {
      return safelyHandle(async () => {
        const query = parseQuery(request, accountVoiceQuerySchema);
        return jsonResponse(await dependencies.getProvider().listAccountVoices(query));
      });
    },

    listSharedVoices(request: Request): Promise<Response> {
      return safelyHandle(async () => {
        const query = parseQuery(request, sharedVoiceQuerySchema);
        const { useCase, useCases, descriptive, descriptives, ...filters } = query;
        const combinedUseCases = [...(useCase ?? []), ...(useCases ?? [])];
        const combinedDescriptives = [...(descriptive ?? []), ...(descriptives ?? [])];
        const normalized = {
          ...filters,
          ...(combinedUseCases.length ? { useCases: [...new Set(combinedUseCases)] } : {}),
          ...(combinedDescriptives.length ? { descriptives: [...new Set(combinedDescriptives)] } : {}),
        };
        return jsonResponse(await dependencies.getProvider().listSharedVoices(normalized));
      });
    },

    previewSharedVoice(request: Request): Promise<Response> {
      return safelyHandle(async () => {
        const query = parseQuery(request, previewQuerySchema);
        const range = request.headers.get("range") ?? undefined;
        const audio = await dependencies.getProvider().previewSharedVoice(query.url, range);
        return audioResponse(audio, { varyRange: true });
      });
    },

    addSharedVoice(request: Request, rawParams: unknown): Promise<Response> {
      return safelyHandle(async () => {
        assertSameOrigin(request);
        const { publicOwnerId, voiceId } = sharedVoicePathSchema.parse(rawParams);
        const body = await parseJson(request, addSharedVoiceBodySchema);
        const added = await dependencies.getProvider().addSharedVoice(publicOwnerId, voiceId, {
          newName: body.newName ?? `Shared ${voiceId.slice(0, 12)}`,
          bookmarked: body.bookmarked ?? true,
        });
        return jsonResponse(added);
      });
    },

    synthesize(request: Request): Promise<Response> {
      return safelyHandle(async () => {
        assertSameOrigin(request);
        const body = await parseJson(request, speechBodySchema);
        const audio = await dependencies.getProvider().synthesize(body);
        return audioResponse(audio, { fileName: downloadName(audio.mimeType) });
      });
    },
  };
}

export const statelessApi = createStatelessApi({ getProvider: getVoiceProvider });
