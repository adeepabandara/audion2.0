import type { GenerateContentParameters, GenerateContentResponse } from '@google/genai';

/** The slice of @google/genai the services use, so tests can supply a fake. */
export interface GenAIClient {
  models: { generateContent(params: GenerateContentParameters): Promise<GenerateContentResponse> };
}
