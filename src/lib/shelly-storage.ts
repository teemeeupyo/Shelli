export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

export type Conversation = {
  id: string
  title: string
  updatedAt: string
  messages: ChatMessage[]
}

export type MemoryNote = { id: string; text: string; createdAt: string }
export type RegisteredTool = { id: string; name: string; description: string; createdAt: string }
export type LocalFileRef = { id: string; name: string; size: number; type: string; addedAt: string }

export type ShellySettings = {
  endpoint: string
  model: string
  apiKey: string
  temperature: number
  approvedActions: string[]
}

export type WorkspaceData = {
  conversations: Conversation[]
  settings: ShellySettings
  memories: MemoryNote[]
  registeredTools: RegisteredTool[]
  files: LocalFileRef[]
}

const STORAGE_KEY = 'shelly-os.workspace.v1'

export const defaultWorkspace: WorkspaceData = {
  conversations: [],
  settings: {
    endpoint: 'http://127.0.0.1:1234/v1',
    model: '',
    apiKey: '',
    temperature: 0.7,
    approvedActions: [],
  },
  memories: [],
  registeredTools: [],
  files: [],
}

export function readWorkspace(): WorkspaceData {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return defaultWorkspace
    const parsed = JSON.parse(saved) as Partial<WorkspaceData>
    return {
      ...defaultWorkspace,
      ...parsed,
      settings: { ...defaultWorkspace.settings, ...parsed.settings },
      conversations: Array.isArray(parsed.conversations) ? parsed.conversations : [],
      memories: Array.isArray(parsed.memories) ? parsed.memories : [],
      registeredTools: Array.isArray(parsed.registeredTools) ? parsed.registeredTools : [],
      files: Array.isArray(parsed.files) ? parsed.files : [],
    }
  } catch {
    return defaultWorkspace
  }
}

export function writeWorkspace(data: WorkspaceData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    throw new Error('Browser storage is full or unavailable. Export or remove some local data, then try again.')
  }
}

export function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `shelly-${Date.now()}-${Math.random().toString(36).slice(2)}`
}
