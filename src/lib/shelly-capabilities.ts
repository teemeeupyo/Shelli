export type ApprovedAction = {
  id: string
  name: string
  detail: string
  sensitivity: 'low' | 'high'
}

export const proposedActions: ApprovedAction[] = [
  { id: 'open-app', name: 'Open an application', detail: 'Launch an app by name after local confirmation.', sensitivity: 'high' },
  { id: 'move-file', name: 'Move or rename a file', detail: 'Change a file location only after reviewing the exact path.', sensitivity: 'high' },
  { id: 'create-note', name: 'Create a local note', detail: 'Save a text note in the Shelly workspace.', sensitivity: 'low' },
]

export const integrationCatalog = [
  { name: 'OpenAI-compatible endpoint', detail: 'Direct browser connection to a configured local or compatible server.', state: 'Available' },
  { name: 'Offline speech recognition', detail: 'Designed for a future local Whisper-compatible service.', state: 'Not connected' },
  { name: 'Piper text-to-speech', detail: 'Designed for a future local voice service.', state: 'Not connected' },
  { name: 'Windows automation bridge', detail: 'Requires a secure local companion; no OS actions are available here.', state: 'Unavailable' },
]

