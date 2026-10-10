export type ModelOption = { id: string; object?: string }
export type InferenceMessage = { role: 'system' | 'user' | 'assistant'; content: string }

type CompletionResponse = { choices?: Array<{ message?: { content?: string } }> }

function endpointUrl(endpoint: string, path: string): string {
  return `${endpoint.trim().replace(/\/+$/, '')}/${path}`
}

function requestHeaders(apiKey: string): HeadersInit {
  return {
    'Content-Type': 'application/json',
    ...(apiKey.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {}),
  }
}

async function readError(response: Response): Promise<string> {
  const text = await response.text().catch(() => '')
  try {
    const body = JSON.parse(text) as { error?: string | { message?: string }; message?: string }
    if (typeof body.error === 'string') return body.error
    if (body.error?.message) return body.error.message
    if (body.message) return body.message
  } catch {
    // A server may return plain text instead of an OpenAI-compatible error object.
  }
  return text || `The local server returned HTTP ${response.status}.`
}

export async function discoverModels(endpoint: string, apiKey: string): Promise<ModelOption[]> {
  const response = await fetch(endpointUrl(endpoint, 'models'), {
    method: 'GET',
    headers: requestHeaders(apiKey),
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new Error(await readError(response))
  const body = await response.json() as { data?: ModelOption[] }
  return Array.isArray(body.data) ? body.data.filter((model) => typeof model.id === 'string') : []
}

export async function requestCompletion(
  endpoint: string,
  apiKey: string,
  model: string,
  messages: InferenceMessage[],
  temperature: number,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetch(endpointUrl(endpoint, 'chat/completions'), {
    method: 'POST',
    headers: requestHeaders(apiKey),
    body: JSON.stringify({ model, messages, temperature, stream: false }),
    signal: signal ?? AbortSignal.timeout(120000),
  })
  if (!response.ok) throw new Error(await readError(response))
  const result = await response.json() as CompletionResponse
  const content = result.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('The endpoint responded, but no assistant message was returned.')
  }
  return content
}
