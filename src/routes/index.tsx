import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Activity, AudioLines, Bot, Boxes, BrainCircuit, Check, ChevronDown, ChevronLeft,
  CircleHelp, Cpu, FileText, FolderOpen, Gauge, HardDrive, Link2,
  LockKeyhole, Menu, MessageSquare, Mic, PanelLeftClose, PanelLeftOpen,
  Plus, Radio, RefreshCw, Search, Send, Server, Settings2, ShieldCheck, Sparkles,
  Square, Trash2, Volume2, X,
} from 'lucide-react'
import {
  defaultWorkspace, newId, readWorkspace, writeWorkspace,
  type ChatMessage, type Conversation, type WorkspaceData,
} from '@/lib/shelly-storage'
import { discoverModels, requestCompletion, type ModelOption } from '@/lib/shelly-inference'
import { integrationCatalog, proposedActions } from '@/lib/shelly-capabilities'
import { automationService } from '@/lib/shelly-automation'
import { voiceService } from '@/lib/shelly-voice'

/**
 * Home route (/). A neutral, FULL-BLEED starting point — no app chrome, no
 * sidebar. Replace this body with your real landing page or app home.
 *
 * Add more pages as files under `src/routes/` (e.g. `src/routes/about.tsx`
 * → /about). The HTML document + providers live once in `__root.tsx`.
 *
 * Building a SaaS / dashboard app? The sidebar shell already exists at
 * `src/routes/app.tsx` with its home at `src/routes/app/index.tsx` (→ /app) — add
 * your pages as files in `src/routes/app/`. Do NOT create a `src/routes/_app.tsx`:
 * a `_`-prefixed layout is PATHLESS, so `_app/index.tsx` resolves to `/` and
 * collides with THIS file (build fails: "Conflicting configuration paths").
 * Dashboard-only product? Keep this file and redirect it to `/app`.
 * Landing pages, marketing sites, content, and games stay full-bleed (default) —
 * delete `src/routes/app.tsx` + `src/routes/app/` if you don't need a dashboard.
 *
 * SEO: set per-page title/description/Open Graph here in `head()`.
 *
 * SSR / routing (this template is server-rendered — TanStack Start):
 * - Routes are files under `src/routes/` that `export const Route =
 *   createFileRoute('/path')({ component })`. NEVER `export default` a route.
 *   Navigate with `Link` from `@tanstack/react-router` (there is no `NavLink`).
 * - Reading Blink auth/SDK state (`blink.auth`), `localStorage`, or `window` at
 *   render CRASHES SSR / hydration-mismatches and ships a blank first page. Wrap
 *   that subtree in `<BlinkClientBoundary fallback={…}>` (from
 *   `@/components/BlinkClientBoundary`) — wrap the whole tree if the entire page
 *   needs the browser. Keep static content outside the boundary. Do NOT use the
 *   route's `ssr: false`: a client-only route in this template hits Start's
 *   server-context `node:async_hooks` path (a throwing browser stub) and ships a
 *   BLANK preview ("AsyncLocalStorage is not a constructor").
 */
export const Route = createFileRoute('/')({
  head: () => ({
    meta: [
      { title: 'Shelly OS · Local AI Assistant' },
      { name: 'description', content: 'A privacy-first desktop-style interface for your local AI assistant.' },
    ],
  }),
  component: Home,
})

type Section = 'chat' | 'voice' | 'automations' | 'files' | 'memory' | 'integrations' | 'settings'
type ConnectionState = 'checking' | 'connected' | 'disconnected'

const sections: { id: Section; label: string; icon: typeof MessageSquare }[] = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'voice', label: 'Voice', icon: AudioLines },
  { id: 'automations', label: 'Automations', icon: Activity },
  { id: 'files', label: 'File manager', icon: FolderOpen },
  { id: 'memory', label: 'Memory', icon: BrainCircuit },
  { id: 'integrations', label: 'Integrations', icon: Boxes },
  { id: 'settings', label: 'Settings', icon: Settings2 },
]

function Home() {
  const [workspace, setWorkspace] = useState<WorkspaceData>(defaultWorkspace)
  const [hydrated, setHydrated] = useState(false)
  const [section, setSection] = useState<Section>('chat')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [historySearch, setHistorySearch] = useState('')
  const [draft, setDraft] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [chatError, setChatError] = useState('')
  const [retryText, setRetryText] = useState('')
  const [connection, setConnection] = useState<ConnectionState>('checking')
  const [connectionError, setConnectionError] = useState('')
  const [models, setModels] = useState<ModelOption[]>([])
  const [settingsDraft, setSettingsDraft] = useState(defaultWorkspace.settings)
  const [storageWarning, setStorageWarning] = useState('')
  const [memoryDraft, setMemoryDraft] = useState('')
  const [toolName, setToolName] = useState('')
  const [toolDescription, setToolDescription] = useState('')
  const [toolNotice, setToolNotice] = useState('')
  const [fileNotice, setFileNotice] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const messageEnd = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = readWorkspace()
      setWorkspace(saved)
      setSettingsDraft(saved.settings)
      setActiveConversationId(saved.conversations[0]?.id ?? null)
      setHydrated(true)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        const conversation: Conversation = { id: newId(), title: 'New conversation', updatedAt: new Date().toISOString(), messages: [] }
        setWorkspace((current) => ({ ...current, conversations: [conversation, ...current.conversations] }))
        setActiveConversationId(conversation.id)
        setChatError('')
        setRetryText('')
        setSection('chat')
      }
      if (event.key === 'Escape') setMobileNavOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    try {
      writeWorkspace(workspace)
      window.setTimeout(() => setStorageWarning(''), 0)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save to this browser.'
      window.setTimeout(() => setStorageWarning(message), 0)
    }
  }, [hydrated, workspace])

  const checkConnection = useCallback(async (endpoint = workspace.settings.endpoint, apiKey = workspace.settings.apiKey) => {
    setConnection('checking')
    setConnectionError('')
    try {
      const available = await discoverModels(endpoint, apiKey)
      setModels(available)
      setConnection('connected')
      if (available.length === 0) setConnectionError('Connected, but no models were listed. Enter a model ID in Settings.')
      return available
    } catch (error) {
      setConnection('disconnected')
      setModels([])
      setConnectionError(error instanceof Error ? error.message : 'The endpoint could not be reached.')
      return []
    }
  }, [workspace.settings.apiKey, workspace.settings.endpoint])

  useEffect(() => {
    if (!hydrated) return
    const timer = window.setTimeout(() => void checkConnection(), 0)
    return () => window.clearTimeout(timer)
  }, [hydrated, checkConnection])

  useEffect(() => {
    messageEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [activeConversationId, workspace.conversations, isSending])

  const activeConversation = workspace.conversations.find((conversation) => conversation.id === activeConversationId) ?? null
  const filteredConversations = useMemo(() => {
    const query = historySearch.trim().toLowerCase()
    return [...workspace.conversations]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .filter((conversation) => !query || conversation.title.toLowerCase().includes(query) ||
        conversation.messages.some((message) => message.content.toLowerCase().includes(query)))
  }, [historySearch, workspace.conversations])

  function chooseSection(next: Section) {
    setSection(next)
    setMobileNavOpen(false)
  }

  function createConversation() {
    const conversation: Conversation = {
      id: newId(), title: 'New conversation', updatedAt: new Date().toISOString(), messages: [],
    }
    setWorkspace((current) => ({ ...current, conversations: [conversation, ...current.conversations] }))
    setActiveConversationId(conversation.id)
    setChatError('')
    setRetryText('')
    chooseSection('chat')
  }

  function removeConversation(conversation: Conversation) {
    if (!window.confirm(`Delete “${conversation.title}” from this browser? This cannot be undone.`)) return
    setWorkspace((current) => ({
      ...current, conversations: current.conversations.filter((item) => item.id !== conversation.id),
    }))
    if (activeConversationId === conversation.id) setActiveConversationId(null)
  }

  async function sendMessage(retrying = false) {
    const content = retrying ? retryText : draft.trim()
    if (!content || isSending) return
    if (!settingsDraft.endpoint.trim() || !settingsDraft.model.trim()) {
      setChatError('Add an endpoint and choose a model in Settings before sending a message.')
      return
    }

    let conversation = activeConversation
    if (!conversation) {
      conversation = { id: newId(), title: 'New conversation', updatedAt: new Date().toISOString(), messages: [] }
      setActiveConversationId(conversation.id)
    }
    const userMessage: ChatMessage | null = retrying ? null : {
      id: newId(), role: 'user', content, createdAt: new Date().toISOString(),
    }
    const history = userMessage ? [...conversation.messages, userMessage] : conversation.messages
    if (userMessage) {
      const nextTitle = conversation.messages.length === 0 ? content.replace(/\s+/g, ' ').slice(0, 44) : conversation.title
      setWorkspace((current) => ({
        ...current,
        conversations: current.conversations.some((item) => item.id === conversation?.id)
          ? current.conversations.map((item) => item.id === conversation?.id
              ? { ...item, title: nextTitle || 'New conversation', updatedAt: userMessage.createdAt, messages: [...item.messages, userMessage] }
              : item)
          : [{ ...conversation!, title: nextTitle || 'New conversation', updatedAt: userMessage.createdAt, messages: [userMessage] }, ...current.conversations],
      }))
      setDraft('')
      setRetryText(content)
    }
    setChatError('')
    setIsSending(true)
    const controller = new AbortController()
    abortRef.current = controller
    const memoryContext = workspace.memories.map((note) => `- ${note.text}`).join('\n')
    const prompt = [
      'You are Shelly OS, a thoughtful personal assistant running through the user-configured OpenAI-compatible endpoint.',
      'Be clear about uncertainty. Never claim to control the computer, inspect local files, or know live system metrics unless the user provides that information.',
      memoryContext ? `User-approved local memory:\n${memoryContext}` : '',
    ].filter(Boolean).join('\n\n')
    try {
      const answer = await requestCompletion(
        settingsDraft.endpoint, settingsDraft.apiKey, settingsDraft.model,
        [{ role: 'system', content: prompt }, ...history.map(({ role, content: messageContent }) => ({ role, content: messageContent }))],
        settingsDraft.temperature, controller.signal,
      )
      const assistantMessage: ChatMessage = { id: newId(), role: 'assistant', content: answer, createdAt: new Date().toISOString() }
      setWorkspace((current) => ({
        ...current,
        conversations: current.conversations.map((item) => item.id === conversation?.id
          ? { ...item, updatedAt: assistantMessage.createdAt, messages: [...item.messages, assistantMessage] }
          : item),
      }))
      setRetryText('')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setChatError('Response stopped. You can retry the last message.')
      } else {
        setChatError(error instanceof Error ? error.message : 'The endpoint request failed.')
      }
    } finally {
      abortRef.current = null
      setIsSending(false)
    }
  }

  function stopResponse() {
    abortRef.current?.abort()
  }

  function saveSettings() {
    const endpoint = settingsDraft.endpoint.trim().replace(/\/+$/, '')
    setSettingsDraft((current) => ({ ...current, endpoint }))
    setWorkspace((current) => ({ ...current, settings: { ...settingsDraft, endpoint, approvedActions: current.settings.approvedActions } }))
  }

  function addMemory() {
    const text = memoryDraft.trim()
    if (!text) return
    setWorkspace((current) => ({
      ...current,
      memories: [{ id: newId(), text, createdAt: new Date().toISOString() }, ...current.memories],
    }))
    setMemoryDraft('')
  }

  function addTool(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = toolName.trim()
    const description = toolDescription.trim()
    if (!name || !description) return
    setWorkspace((current) => ({
      ...current,
      registeredTools: [{ id: newId(), name, description, createdAt: new Date().toISOString() }, ...current.registeredTools],
    }))
    setToolName('')
    setToolDescription('')
    setToolNotice('Registered as local metadata only. It cannot run until a secure integration is built.')
  }

  function addFiles(files: FileList | null) {
    if (!files?.length) return
    const added = Array.from(files).map((file) => ({
      id: newId(), name: file.name, size: file.size, type: file.type || 'Unknown file type', addedAt: new Date().toISOString(),
    }))
    setWorkspace((current) => ({ ...current, files: [...added, ...current.files] }))
    setFileNotice(`${added.length} file${added.length === 1 ? '' : 's'} added as browser-only references. The files themselves were not uploaded or copied.`)
    if (fileInput.current) fileInput.current.value = ''
  }

  function exportWorkspace() {
    const exportData = { ...workspace, settings: { ...workspace.settings, apiKey: '' } }
    const file = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(file)
    link.download = 'shelly-os-workspace.json'
    link.click()
    URL.revokeObjectURL(link.href)
  }

  function clearWorkspace() {
    if (!window.confirm('Erase all Shelly OS conversations, memories, file references and settings from this browser? This cannot be undone.')) return
    setWorkspace(defaultWorkspace)
    setSettingsDraft(defaultWorkspace.settings)
    setActiveConversationId(null)
    setConnection('disconnected')
    setModels([])
    setConnectionError('Workspace cleared. Configure an endpoint and check the connection to continue.')
  }

  const currentTitle = sections.find((item) => item.id === section)?.label ?? 'Chat'
  const connected = connection === 'connected'
  const statusLabel = connection === 'checking' ? 'Checking endpoint' : connected ? 'Endpoint connected' : 'Endpoint offline'

  return (
    <div className="flex h-dvh min-h-[520px] overflow-hidden bg-background text-foreground">
      {mobileNavOpen && <button aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} className="fixed inset-0 z-30 bg-background/75 backdrop-blur-sm lg:hidden" />}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-[270px] flex-col border-r border-sidebar-border bg-sidebar transition-[transform,width] duration-300 ease-out lg:static lg:translate-x-0 ${mobileNavOpen ? 'translate-x-0' : '-translate-x-full'} ${sidebarCollapsed ? 'lg:w-[76px]' : 'lg:w-[252px]'}`}>
        <div className="flex h-[72px] shrink-0 items-center gap-3 border-b border-sidebar-border px-5">
          <div className="relative grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-primary/30 bg-primary/10 text-primary shadow-[0_0_26px_color-mix(in_oklch,var(--primary)_15%,transparent)]">
            <Bot className="h-[19px] w-[19px]" />
            <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-sidebar bg-chart-4" />
          </div>
          {!sidebarCollapsed && <div className="min-w-0 flex-1"><div className="truncate text-[14px] font-semibold tracking-[0.09em]">SHELLY <span className="text-primary">OS</span></div><div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground">Personal intelligence</div></div>}
          <button aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => setSidebarCollapsed((value) => !value)} className="hidden rounded-lg p-2 text-muted-foreground transition hover:bg-sidebar-accent hover:text-foreground lg:block">
            {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
          <button aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} className="ml-auto rounded-lg p-2 text-muted-foreground lg:hidden"><X className="h-4 w-4" /></button>
        </div>

        <div className="px-3 pt-5">
          <button onClick={createConversation} title="Start a new conversation" className={`group flex h-10 w-full items-center gap-2.5 rounded-xl border border-primary/20 bg-primary/[0.09] px-3 text-sm font-medium text-primary transition hover:border-primary/40 hover:bg-primary/[0.14] active:scale-[0.99] ${sidebarCollapsed ? 'lg:justify-center lg:px-0' : ''}`}>
            <Plus className="h-4 w-4 shrink-0" />{!sidebarCollapsed && <><span>New conversation</span><span className="ml-auto rounded border border-primary/20 px-1.5 py-0.5 font-mono text-[9px] text-primary/70">⌘ K</span></>}
          </button>
        </div>

        <nav aria-label="Main navigation" className="mt-6 px-3">
          {!sidebarCollapsed && <div className="mb-2 px-2 font-mono text-[9px] font-medium uppercase tracking-[0.2em] text-muted-foreground/75">Workspace</div>}
          <div className="space-y-1">
            {sections.map(({ id, label, icon: Icon }) => (
              <button key={id} title={sidebarCollapsed ? label : undefined} onClick={() => chooseSection(id)} className={`flex h-10 w-full items-center gap-3 rounded-xl px-3 text-left text-[13px] transition ${section === id ? 'bg-sidebar-accent text-foreground shadow-sm' : 'text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground'} ${sidebarCollapsed ? 'lg:justify-center lg:px-0' : ''}`}>
                <Icon className={`h-[17px] w-[17px] shrink-0 ${section === id ? 'text-primary' : ''}`} />
                {!sidebarCollapsed && <span className="flex-1">{label}</span>}
                {!sidebarCollapsed && id === 'chat' && workspace.conversations.length > 0 && <span className="font-mono text-[10px] text-muted-foreground/70">{workspace.conversations.length}</span>}
              </button>
            ))}
          </div>
        </nav>

        {!sidebarCollapsed && <div className="mt-7 min-h-0 flex-1 px-3">
          <div className="mb-2 flex items-center justify-between px-2">
            <span className="font-mono text-[9px] font-medium uppercase tracking-[0.2em] text-muted-foreground/75">Recent sessions</span>
            <span className="font-mono text-[9px] text-muted-foreground/60">{workspace.conversations.length.toString().padStart(2, '0')}</span>
          </div>
          <label className="relative mb-2 block">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70" />
            <input value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} placeholder="Search conversations" aria-label="Search conversations" className="h-9 w-full rounded-lg border border-border/70 bg-background/60 pl-8 pr-3 text-xs outline-none transition placeholder:text-muted-foreground/65 focus:border-primary/50 focus:ring-2 focus:ring-primary/10" />
          </label>
          <div className="max-h-[calc(100%-3rem)] space-y-1 overflow-y-auto pr-1">
            {filteredConversations.map((conversation) => (
              <div key={conversation.id} className={`group flex items-center gap-1 rounded-lg pr-1 transition ${activeConversationId === conversation.id ? 'bg-sidebar-accent/80' : 'hover:bg-sidebar-accent/50'}`}>
                <button onClick={() => { setActiveConversationId(conversation.id); setChatError(''); setRetryText(''); chooseSection('chat') }} className="min-w-0 flex-1 px-2.5 py-2 text-left">
                  <span className={`block truncate text-xs ${activeConversationId === conversation.id ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground'}`}>{conversation.title}</span>
                  <span className="mt-1 block font-mono text-[9px] text-muted-foreground/60">{conversation.messages.length} messages</span>
                </button>
                <button onClick={() => removeConversation(conversation)} aria-label={`Delete ${conversation.title}`} title="Delete conversation" className="rounded p-1.5 text-muted-foreground/60 opacity-0 transition hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus:opacity-100"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
            {filteredConversations.length === 0 && <p className="px-2.5 py-3 text-xs text-muted-foreground">{historySearch ? 'No matching conversations.' : 'Your saved conversations will appear here.'}</p>}
          </div>
        </div>}

        <div className={`shrink-0 border-t border-sidebar-border p-3 ${sidebarCollapsed ? 'lg:px-2' : ''}`}>
          <div className={`rounded-xl border border-border/70 bg-background/40 p-3 ${sidebarCollapsed ? 'lg:flex lg:justify-center lg:p-2' : ''}`}>
            <div className={`flex items-center gap-2.5 ${sidebarCollapsed ? 'lg:justify-center' : ''}`}>
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent"><ShieldCheck className="h-4 w-4" /></div>
              {!sidebarCollapsed && <div className="min-w-0"><div className="text-[11px] font-medium">Private by design</div><div className="mt-0.5 truncate text-[10px] text-muted-foreground">Saved in this browser only</div></div>}
            </div>
          </div>
          {!sidebarCollapsed && <div className="mt-3 flex items-center justify-between px-1 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground/60"><span>Desktop preview</span><span>v0.1</span></div>}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-[72px] shrink-0 items-center justify-between border-b border-border/70 bg-background/90 px-4 md:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <button aria-label="Open navigation" onClick={() => setMobileNavOpen(true)} className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"><Menu className="h-4 w-4" /></button>
            <div className="min-w-0"><div className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground">Shelly OS <span className="mx-1 text-border">/</span> Workspace</div><div className="mt-1 truncate text-sm font-medium">{currentTitle}</div></div>
          </div>
          <div className="flex items-center gap-2 md:gap-3">
            <span className="hidden font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground xl:inline">{workspace.settings.model || 'No model selected'}</span>
            <div className="hidden h-4 w-px bg-border xl:block" />
            <div title={statusLabel} className="flex items-center gap-2 rounded-full border border-border/80 bg-card/70 px-2.5 py-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${connection === 'checking' ? 'animate-pulse bg-chart-5' : connected ? 'bg-chart-4' : 'bg-muted-foreground/60'}`} />
              <span className="hidden text-[11px] text-muted-foreground sm:inline">{connection === 'checking' ? 'Checking' : connected ? 'Local endpoint' : 'Offline'}</span>
            </div>
            <button onClick={() => chooseSection('settings')} aria-label="Open settings" title="Settings" className="rounded-lg border border-border/80 p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground"><Settings2 className="h-4 w-4" /></button>
          </div>
        </header>

        {section === 'chat' && <>
          <div className="grid shrink-0 grid-cols-2 gap-2 border-b border-border/60 bg-card/[0.24] px-4 py-3 md:grid-cols-4 md:px-7">
            <SystemSignal icon={Cpu} label="CPU" value="Not exposed" />
            <SystemSignal icon={HardDrive} label="Memory" value="Not exposed" />
            <SystemSignal icon={Gauge} label="GPU" value="Not exposed" />
            <SystemSignal icon={Radio} label="Connectivity" value={connection === 'checking' ? 'Checking…' : connected ? 'Connected' : 'Offline'} accent={connected} />
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-8 md:py-7">
              <div className="mx-auto flex min-h-full w-full max-w-[900px] flex-col">
                {activeConversation?.messages.length ? <>
                  <div className="mb-6 flex items-center justify-between border-b border-border/50 pb-4">
                    <div className="min-w-0"><div className="truncate text-sm font-medium">{activeConversation.title}</div><div className="mt-1 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">{activeConversation.messages.length} saved messages · local to this browser</div></div>
                    <button onClick={() => removeConversation(activeConversation)} className="rounded-lg p-2 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive" title="Delete conversation"><Trash2 className="h-4 w-4" /></button>
                  </div>
                  <div className="space-y-7">
                    {activeConversation.messages.map((message) => <MessageRow key={message.id} message={message} />)}
                    {isSending && <div className="flex items-start gap-3"><AssistantMark /><div className="flex items-center gap-2 rounded-2xl border border-border/70 bg-card px-4 py-3 text-xs text-muted-foreground"><span className="flex gap-1"><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary" /><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:120ms]" /><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:240ms]" /></span>Waiting for the configured model…</div></div>}
                    <div ref={messageEnd} />
                  </div>
                </> : <WelcomeScreen onPrompt={(text) => setDraft(text)} connected={connected} model={workspace.settings.model} />}
              </div>
            </div>
            <div className="shrink-0 border-t border-border/60 bg-background/90 px-4 pb-4 pt-3 md:px-8 md:pb-6">
              <div className="mx-auto max-w-[900px]">
                {chatError && <div role="alert" className="mb-3 flex items-start gap-2 rounded-xl border border-destructive/25 bg-destructive/10 px-3.5 py-3 text-xs text-foreground"><CircleHelp className="mt-0.5 h-4 w-4 shrink-0 text-destructive" /><div className="min-w-0 flex-1"><p className="font-medium">Response could not be completed</p><p className="mt-1 break-words text-muted-foreground">{chatError}</p>{retryText && <button onClick={() => void sendMessage(true)} disabled={isSending} className="mt-2 font-medium text-primary hover:underline">Retry last message</button>}</div><button onClick={() => setChatError('')} aria-label="Dismiss error" className="rounded p-1 text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button></div>}
                {!workspace.settings.model && <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-chart-5/20 bg-chart-5/[0.06] px-3 py-2.5 text-[11px]"><span className="text-muted-foreground">Choose a model in Settings to start a local chat.</span><button onClick={() => chooseSection('settings')} className="shrink-0 font-medium text-primary hover:underline">Configure endpoint</button></div>}
                <form onSubmit={(event) => { event.preventDefault(); void sendMessage() }} className="rounded-2xl border border-border bg-card/85 p-2 shadow-md transition focus-within:border-primary/40 focus-within:shadow-[0_0_0_3px_color-mix(in_oklch,var(--primary)_10%,transparent)]">
                  <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage() } }} rows={2} placeholder="Message Shelly…" aria-label="Message Shelly" className="max-h-40 min-h-[58px] w-full resize-y bg-transparent px-3 py-2 text-sm leading-6 outline-none placeholder:text-muted-foreground/70" />
                  <div className="flex items-center justify-between px-1 pb-0.5">
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground"><span className="flex items-center gap-1.5"><span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-chart-4' : 'bg-muted-foreground/60'}`} />{connected ? 'Local endpoint' : 'No endpoint connection'}</span><span className="text-border">·</span><span>Shift + Enter for a new line</span></div>
                    {isSending ? <button type="button" onClick={stopResponse} aria-label="Stop response" title="Stop response" className="grid h-9 w-9 place-items-center rounded-xl border border-border bg-muted text-foreground transition hover:bg-accent/20"><Square className="h-3.5 w-3.5 fill-current" /></button> : <button type="submit" disabled={!draft.trim()} aria-label="Send message" title="Send message" className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground transition hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"><Send className="h-4 w-4" /></button>}
                  </div>
                </form>
                <p className="mt-2 text-center text-[10px] text-muted-foreground/70">Requests go directly from this browser to your configured endpoint. No cloud model is bundled.</p>
              </div>
            </div>
          </div>
        </>}

        {section === 'voice' && <section className="min-h-0 flex-1 overflow-y-auto px-4 py-7 md:px-8 md:py-9"><div className="mx-auto max-w-[850px]"><SectionHeading eyebrow="VOICE INTERFACE" title="Voice" description="A calm control surface for future offline speech recognition and Piper voice output. No microphone or audio device is accessed in this version." /><div className="mb-5 grid gap-5 lg:grid-cols-[1.1fr_0.9fr]"><div className="flex min-h-[330px] flex-col items-center justify-center rounded-3xl border border-border bg-card/55 px-6 py-8 text-center"><div className="relative grid h-36 w-36 place-items-center rounded-full border border-accent/20 bg-accent/[0.04] shadow-[0_0_70px_color-mix(in_oklch,var(--accent)_12%,transparent)]"><div className="absolute inset-3 rounded-full border border-primary/15" /><div className="absolute inset-7 rounded-full border border-accent/20" /><div className="grid h-16 w-16 place-items-center rounded-full bg-gradient-to-br from-primary/20 to-accent/20 text-accent"><AudioLines className="h-7 w-7" /></div></div><div className="shelly-voice-bars mt-7 flex h-7 items-center gap-1.5" aria-label="Decorative idle voice visualization">{Array.from({ length: 9 }, (_, index) => <span key={index} className="w-1 rounded-full bg-primary/70" />)}</div><p className="mt-4 font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground">Ambient visualization · microphone inactive</p><p className="mt-2 text-sm font-medium">{voiceService.status === 'unconnected' ? 'Voice services not connected' : 'Voice service unavailable'}</p></div><div className="space-y-3"><div className="rounded-2xl border border-border bg-card/55 p-4"><div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary"><Mic className="h-4 w-4" /></div><div><h2 className="text-xs font-medium">Speech recognition</h2><p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Offline engine not connected</p></div></div><button disabled title="Microphone access is not connected" className="mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-border bg-muted/30 text-xs text-muted-foreground disabled:cursor-not-allowed"><Mic className="h-3.5 w-3.5" />Microphone unavailable</button></div><div className="rounded-2xl border border-border bg-card/55 p-4"><div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-xl bg-accent/10 text-accent"><Volume2 className="h-4 w-4" /></div><div><h2 className="text-xs font-medium">Voice output</h2><p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Piper service not connected</p></div></div><button disabled title="Piper text-to-speech is not connected" className="mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-border bg-muted/30 text-xs text-muted-foreground disabled:cursor-not-allowed"><Volume2 className="h-3.5 w-3.5" />Playback unavailable</button></div><button onClick={() => chooseSection('integrations')} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-xs font-medium text-primary-foreground transition hover:brightness-110"><Link2 className="h-4 w-4" />View local integrations</button></div></div><div className="rounded-2xl border border-primary/15 bg-primary/[0.04] p-4 text-xs leading-5 text-muted-foreground"><span className="font-medium text-foreground">Future-ready, not simulated.</span> The animated waveform is decorative standby art only. Shelly is not listening, transcribing, or speaking.</div></div></section>}
+
+        {section === 'automations' && <section className="min-h-0 flex-1 overflow-y-auto px-4 py-7 md:px-8 md:py-9"><div className="mx-auto max-w-[850px]"><SectionHeading eyebrow="LOCAL ACTIONS" title="Automations" description="Choose what a future local companion may request. These preferences are saved here, but no action is executable from this web app." /><div className="mb-6 flex items-start gap-3 rounded-2xl border border-chart-5/20 bg-chart-5/[0.06] p-4"><LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-chart-5" /><div><p className="text-sm font-medium">{automationService.status === 'locked' ? 'Execution is locked' : 'Automation unavailable'}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">A secure Windows companion must enforce permissions and ask for confirmation immediately before any sensitive or destructive action. Selecting a preference below does not execute anything.</p></div></div><div className="overflow-hidden rounded-2xl border border-border bg-card/70">{proposedActions.map((action, index) => <label key={action.id} className={`flex cursor-pointer items-start gap-4 p-4 transition hover:bg-muted/30 md:p-5 ${index ? 'border-t border-border/70' : ''}`}><input type="checkbox" checked={workspace.settings.approvedActions.includes(action.id)} onChange={(event) => setWorkspace((current) => ({ ...current, settings: { ...current.settings, approvedActions: event.target.checked ? [...current.settings.approvedActions, action.id] : current.settings.approvedActions.filter((id) => id !== action.id) } }))} className="mt-1 h-4 w-4 accent-[var(--primary)]" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium">{action.name}</span><span className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${action.sensitivity === 'high' ? 'border-chart-5/20 text-chart-5' : 'border-chart-4/20 text-chart-4'}`}>{action.sensitivity} sensitivity</span></div><p className="mt-1.5 text-xs leading-5 text-muted-foreground">{action.detail}</p><p className="mt-2 font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">Preference only · execution unavailable</p></div></label>)}</div></div></section>}

        {section === 'files' && <section className="min-h-0 flex-1 overflow-y-auto px-4 py-7 md:px-8 md:py-9"><div className="mx-auto max-w-[850px]"><SectionHeading eyebrow="BROWSER WORKSPACE" title="File manager" description="Shelly can only see files you explicitly select in this browser. This is not an operating-system file explorer." /><div className="mb-6 rounded-2xl border border-border bg-card/60 p-5 md:p-6"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><FolderOpen className="h-5 w-5" /></div><div><h2 className="text-sm font-medium">Selected file references</h2><p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">Names and basic file details are stored locally. File contents are not copied, uploaded, or included in chat.</p></div></div><button onClick={() => fileInput.current?.click()} className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-border bg-muted/50 px-4 text-xs font-medium transition hover:bg-muted"><Plus className="h-4 w-4" />Choose files</button><input ref={fileInput} type="file" multiple className="sr-only" onChange={(event) => addFiles(event.target.files)} /></div></div>{fileNotice && <p role="status" className="mb-4 rounded-xl border border-chart-4/20 bg-chart-4/[0.06] px-4 py-3 text-xs text-muted-foreground">{fileNotice}</p>}<div className="overflow-hidden rounded-2xl border border-border bg-card/50">{workspace.files.length ? workspace.files.map((file) => <div key={file.id} className="flex items-center gap-3 border-b border-border/60 px-4 py-3.5 last:border-0"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"><FileText className="h-4 w-4" /></div><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{file.name}</p><p className="mt-1 truncate text-[10px] text-muted-foreground">{file.type} · {formatBytes(file.size)}</p></div><button onClick={() => { if (window.confirm(`Remove “${file.name}” from this reference list?`)) setWorkspace((current) => ({ ...current, files: current.files.filter((item) => item.id !== file.id) })) }} aria-label={`Remove ${file.name}`} className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-4 w-4" /></button></div>) : <div className="grid min-h-52 place-items-center px-6 py-10 text-center"><div><HardDrive className="mx-auto h-6 w-6 text-muted-foreground/70" /><p className="mt-3 text-sm font-medium">No files selected</p><p className="mt-1 text-xs text-muted-foreground">Choose files to save their names in this browser workspace.</p></div></div>}</div></div></section>}

        {section === 'memory' && <section className="min-h-0 flex-1 overflow-y-auto px-4 py-7 md:px-8 md:py-9"><div className="mx-auto max-w-[850px]"><SectionHeading eyebrow="USER-CONTROLLED CONTEXT" title="Memory" description="Notes stay in this browser and are included in prompts sent to your configured endpoint. Add only details you want that model to receive." /><form onSubmit={(event) => { event.preventDefault(); addMemory() }} className="mb-6 rounded-2xl border border-border bg-card/70 p-4 md:p-5"><label htmlFor="memory-note" className="mb-2 block text-xs font-medium">Add a note for Shelly</label><textarea id="memory-note" value={memoryDraft} onChange={(event) => setMemoryDraft(event.target.value)} rows={3} placeholder="For example: I prefer concise answers with a short summary first." className="w-full resize-y rounded-xl border border-input bg-background/70 px-3.5 py-3 text-sm outline-none transition placeholder:text-muted-foreground/60 focus:border-primary/50 focus:ring-2 focus:ring-primary/10" /><div className="mt-3 flex items-center justify-between gap-3"><p className="text-[10px] text-muted-foreground">Memory is sent only when you chat with your chosen endpoint.</p><button disabled={!memoryDraft.trim()} className="inline-flex h-9 items-center gap-2 rounded-xl bg-primary px-3.5 text-xs font-medium text-primary-foreground transition hover:brightness-110 disabled:opacity-40"><Plus className="h-3.5 w-3.5" />Save note</button></div></form><div className="space-y-2">{workspace.memories.map((note) => <article key={note.id} className="flex items-start gap-3 rounded-2xl border border-border bg-card/55 p-4"><div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent"><BrainCircuit className="h-4 w-4" /></div><p className="min-w-0 flex-1 whitespace-pre-wrap text-sm leading-6">{note.text}</p><button onClick={() => { if (window.confirm('Delete this memory note?')) setWorkspace((current) => ({ ...current, memories: current.memories.filter((item) => item.id !== note.id) })) }} aria-label="Delete memory note" className="rounded-lg p-2 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-4 w-4" /></button></article>)}{!workspace.memories.length && <div className="rounded-2xl border border-dashed border-border px-5 py-9 text-center"><BrainCircuit className="mx-auto h-6 w-6 text-muted-foreground/60" /><p className="mt-3 text-sm font-medium">No saved memories yet</p><p className="mt-1 text-xs text-muted-foreground">Your notes are optional and can be removed at any time.</p></div>}</div></div></section>}

        {section === 'integrations' && <section className="min-h-0 flex-1 overflow-y-auto px-4 py-7 md:px-8 md:py-9"><div className="mx-auto max-w-[850px]"><SectionHeading eyebrow="CAPABILITY REGISTRY" title="Integrations" description="A registry for future local services. Registration records metadata only; it does not grant access or execute tools." /><div className="mb-6 grid gap-3 sm:grid-cols-2">{integrationCatalog.map((item) => <article key={item.name} className="rounded-2xl border border-border bg-card/55 p-4"><div className="flex items-start justify-between gap-3"><div className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary"><Link2 className="h-4 w-4" /></div><span className={`rounded-full border px-2 py-1 font-mono text-[9px] uppercase tracking-wider ${item.state === 'Available' ? 'border-chart-4/20 text-chart-4' : 'border-border text-muted-foreground'}`}>{item.state}</span></div><h2 className="mt-4 text-sm font-medium">{item.name}</h2><p className="mt-1.5 text-xs leading-5 text-muted-foreground">{item.detail}</p></article>)}</div><form onSubmit={addTool} className="rounded-2xl border border-border bg-card/70 p-4 md:p-5"><div className="mb-4 flex items-start gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent"><Plus className="h-4 w-4" /></div><div><h2 className="text-sm font-medium">Register a future tool</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Save an integration idea in the local registry. It will not be callable until implemented and secured.</p></div></div><div className="grid gap-3 sm:grid-cols-2"><label className="text-[11px] font-medium">Tool name<input value={toolName} onChange={(event) => setToolName(event.target.value)} placeholder="e.g. Local calendar" className="mt-1.5 h-10 w-full rounded-xl border border-input bg-background/70 px-3 text-sm outline-none focus:border-primary/50" /></label><label className="text-[11px] font-medium">What it could do<input value={toolDescription} onChange={(event) => setToolDescription(event.target.value)} placeholder="Brief purpose" className="mt-1.5 h-10 w-full rounded-xl border border-input bg-background/70 px-3 text-sm outline-none focus:border-primary/50" /></label></div><div className="mt-3 flex items-center justify-between gap-3"><span role="status" className="text-[10px] text-muted-foreground">{toolNotice}</span><button disabled={!toolName.trim() || !toolDescription.trim()} className="h-9 shrink-0 rounded-xl bg-primary px-3.5 text-xs font-medium text-primary-foreground transition hover:brightness-110 disabled:opacity-40">Register metadata</button></div></form>{workspace.registeredTools.length > 0 && <div className="mt-6"><h2 className="mb-3 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Your registered metadata</h2><div className="space-y-2">{workspace.registeredTools.map((tool) => <div key={tool.id} className="flex items-center gap-3 rounded-xl border border-border bg-card/40 px-4 py-3"><div className="min-w-0 flex-1"><p className="text-xs font-medium">{tool.name} <span className="ml-2 font-mono text-[9px] uppercase text-muted-foreground">Not executable</span></p><p className="mt-1 text-[11px] text-muted-foreground">{tool.description}</p></div><button onClick={() => { if (window.confirm(`Remove ${tool.name} from the local registry?`)) setWorkspace((current) => ({ ...current, registeredTools: current.registeredTools.filter((item) => item.id !== tool.id) })) }} aria-label={`Remove ${tool.name}`} className="rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-4 w-4" /></button></div>)}</div></div>}</div></section>}

        {section === 'settings' && <section className="min-h-0 flex-1 overflow-y-auto px-4 py-7 md:px-8 md:py-9"><div className="mx-auto max-w-[850px]"><SectionHeading eyebrow="LOCAL CONFIGURATION" title="Settings" description="Connect Shelly to an OpenAI-compatible server. Settings are stored in this browser and can be cleared at any time." /><div className="mb-6 rounded-2xl border border-primary/15 bg-primary/[0.045] p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2.5"><div className={`h-2 w-2 rounded-full ${connection === 'checking' ? 'animate-pulse bg-chart-5' : connected ? 'bg-chart-4' : 'bg-muted-foreground/60'}`} /><div><p className="text-xs font-medium">{statusLabel}</p><p className="mt-1 text-[10px] text-muted-foreground">{connection === 'checking' ? 'Requesting the configured /models endpoint…' : connected ? `${models.length} model${models.length === 1 ? '' : 's'} discovered` : 'No live local connection has been confirmed.'}</p></div></div><button onClick={() => void checkConnection(settingsDraft.endpoint, settingsDraft.apiKey)} disabled={connection === 'checking'} className="inline-flex h-9 items-center gap-2 rounded-xl border border-border bg-card px-3 text-xs font-medium transition hover:bg-muted disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${connection === 'checking' ? 'animate-spin' : ''}`} />Check connection</button></div>{connectionError && <p className="mt-3 break-words border-t border-border/60 pt-3 text-[11px] leading-5 text-muted-foreground">{connectionError}{connection === 'disconnected' && ' Check that the server is running and allows browser CORS requests.'}</p>}</div><div className="space-y-5 rounded-2xl border border-border bg-card/60 p-4 md:p-6"><div><h2 className="text-sm font-medium">Inference endpoint</h2><p className="mt-1 text-xs text-muted-foreground">No cloud provider is preconfigured. LM Studio commonly serves at the address below.</p></div><label className="block text-xs font-medium">Base URL<div className="relative mt-1.5"><Server className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input value={settingsDraft.endpoint} onChange={(event) => setSettingsDraft((current) => ({ ...current, endpoint: event.target.value }))} placeholder="http://127.0.0.1:1234/v1" className="h-11 w-full rounded-xl border border-input bg-background/70 pl-10 pr-3 font-mono text-xs outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/10" /></div></label><div className="grid gap-4 sm:grid-cols-2"><label className="block text-xs font-medium">Model ID{models.length > 0 ? <span className="relative mt-1.5 block"><select value={settingsDraft.model} onChange={(event) => setSettingsDraft((current) => ({ ...current, model: event.target.value }))} className="h-11 w-full appearance-none rounded-xl border border-input bg-background/70 px-3 pr-9 font-mono text-xs outline-none focus:border-primary/50"><option value="">Select discovered model…</option>{models.map((model) => <option key={model.id} value={model.id}>{model.id}</option>)}</select><ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /></span> : <input value={settingsDraft.model} onChange={(event) => setSettingsDraft((current) => ({ ...current, model: event.target.value }))} placeholder="e.g. local-model-name" className="mt-1.5 h-11 w-full rounded-xl border border-input bg-background/70 px-3 font-mono text-xs outline-none focus:border-primary/50" />}</label><label className="block text-xs font-medium">API key <span className="font-normal text-muted-foreground">(optional)</span><input type="password" autoComplete="off" value={settingsDraft.apiKey} onChange={(event) => setSettingsDraft((current) => ({ ...current, apiKey: event.target.value }))} placeholder="Only if your endpoint requires one" className="mt-1.5 h-11 w-full rounded-xl border border-input bg-background/70 px-3 font-mono text-xs outline-none focus:border-primary/50" /></label></div><label className="block text-xs font-medium">Temperature <span className="ml-2 font-mono text-primary">{settingsDraft.temperature.toFixed(1)}</span><input type="range" min="0" max="2" step="0.1" value={settingsDraft.temperature} onChange={(event) => setSettingsDraft((current) => ({ ...current, temperature: Number(event.target.value) }))} className="mt-3 block w-full accent-[var(--primary)]" /><span className="mt-1 flex justify-between font-mono text-[9px] text-muted-foreground"><span>Precise</span><span>More creative</span></span></label><div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-4"><p className="max-w-lg text-[10px] leading-4 text-muted-foreground">A hosted page can reach 127.0.0.1 only on the same device running this browser. Local servers may need CORS enabled. API keys are kept in browser storage, not encrypted.</p><button onClick={saveSettings} className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground transition hover:brightness-110 active:scale-[0.98]"><Check className="h-4 w-4" />Save settings</button></div></div><div className="mt-5 grid gap-3 sm:grid-cols-2"><div className="rounded-2xl border border-border bg-card/50 p-4"><div className="flex items-center gap-2 text-xs font-medium"><HardDrive className="h-4 w-4 text-primary" />Local workspace</div><p className="mt-2 text-[11px] leading-5 text-muted-foreground">Conversations, notes, file references and preferences live in this browser’s local storage.</p><button onClick={exportWorkspace} className="mt-3 inline-flex items-center gap-2 text-[11px] font-medium text-primary hover:underline"><FileText className="h-3.5 w-3.5" />Export workspace JSON (API key excluded)</button></div><div className="rounded-2xl border border-destructive/20 bg-destructive/[0.035] p-4"><div className="flex items-center gap-2 text-xs font-medium"><LockKeyhole className="h-4 w-4 text-destructive" />Sensitive actions remain disabled</div><p className="mt-2 text-[11px] leading-5 text-muted-foreground">This interface has no secure local Windows companion, so it cannot run commands or read live system metrics.</p><button onClick={clearWorkspace} className="mt-3 inline-flex items-center gap-2 text-[11px] font-medium text-destructive hover:underline"><Trash2 className="h-3.5 w-3.5" />Erase local workspace</button></div></div>{storageWarning && <p role="alert" className="mt-4 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-xs text-muted-foreground">{storageWarning}</p>}</div></section>}

      </main>
    </div>
  )
}

function SystemSignal({ icon: Icon, label, value, accent = false }: { icon: typeof Cpu; label: string; value: string; accent?: boolean }) {
  return <div className="flex min-w-0 items-center gap-2.5 rounded-xl border border-border/55 bg-card/35 px-3 py-2"><Icon className={`h-3.5 w-3.5 shrink-0 ${accent ? 'text-chart-4' : 'text-muted-foreground/70'}`} /><span className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">{label}</span><span className={`ml-auto truncate text-[10px] ${accent ? 'text-chart-4' : 'text-muted-foreground/70'}`}>{value}</span></div>
}

function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className="mb-7"><p className="font-mono text-[9px] uppercase tracking-[0.22em] text-primary">{eyebrow}</p><h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-[34px]">{title}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p></div>
}

function AssistantMark() {
  return <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-primary/25 bg-primary/10 text-primary"><Sparkles className="h-4 w-4" /></div>
}

function MessageRow({ message }: { message: ChatMessage }) {
  if (message.role === 'user') return <div className="flex justify-end"><div className="max-w-[88%] rounded-2xl rounded-br-md border border-primary/20 bg-primary/[0.09] px-4 py-3 text-sm leading-7 md:max-w-[78%]"><div className="whitespace-pre-wrap break-words">{message.content}</div><div className="mt-2 text-right font-mono text-[9px] text-muted-foreground/65">YOU · {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div></div></div>
  return <div className="flex items-start gap-3"><AssistantMark /><div className="min-w-0 flex-1 pt-1"><div className="mb-2 flex items-center gap-2"><span className="text-xs font-semibold">Shelly</span><span className="font-mono text-[9px] text-muted-foreground/65">{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div><div className="prose prose-invert prose-sm max-w-none break-words text-[13px] leading-7 text-foreground/90 prose-headings:font-semibold prose-headings:tracking-tight prose-p:my-3 prose-a:text-primary prose-a:underline prose-strong:text-foreground prose-code:rounded-md prose-code:border prose-code:border-border prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:font-mono prose-code:text-[11px] prose-pre:overflow-x-auto prose-pre:rounded-xl prose-pre:border prose-pre:border-border prose-pre:bg-muted/70 prose-pre:p-4 prose-pre:font-mono prose-pre:text-xs prose-li:my-1 prose-blockquote:border-primary/40 prose-blockquote:text-muted-foreground"><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown></div></div></div>
}

function WelcomeScreen({ onPrompt, connected, model }: { onPrompt: (text: string) => void; connected: boolean; model: string }) {
  const prompts = ['Help me plan a focused day', 'Summarize a topic I’m exploring', 'Turn a rough idea into a clear plan']
  return <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
    <div className="relative mb-7 grid h-28 w-28 place-items-center rounded-full border border-primary/20 bg-primary/[0.055] shadow-[0_0_80px_color-mix(in_oklch,var(--primary)_12%,transparent)]">
      <div className="absolute inset-2 rounded-full border border-accent/20" /><div className="absolute inset-5 rounded-full border border-primary/20" />
      <div className="grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-primary/20 to-accent/20 text-primary"><Sparkles className="h-6 w-6" /></div>
      <span className={`absolute right-2 top-4 h-2 w-2 rounded-full ${connected ? 'bg-chart-4' : 'bg-muted-foreground/50'}`} />
    </div>
    <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-primary/90">A private space to think</p>
    <h1 className="mt-3 max-w-xl text-3xl font-medium tracking-tight md:text-[40px]">What would you like to work through?</h1>
    <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">Your conversations stay in this browser. Replies come from your configured model{model ? ` · ${model}` : ''}.</p>
    <div className="mt-8 grid w-full max-w-[620px] gap-2 sm:grid-cols-3">{prompts.map((prompt) => <button key={prompt} onClick={() => onPrompt(prompt)} className="min-h-[68px] rounded-2xl border border-border/80 bg-card/55 px-4 py-3 text-left text-xs leading-5 text-muted-foreground transition hover:-translate-y-0.5 hover:border-primary/30 hover:bg-card hover:text-foreground">{prompt}<ChevronLeft className="ml-1 inline h-3 w-3 rotate-180 text-primary" /></button>)}</div>
    {!connected && <div className="mt-6 flex items-center gap-2 text-[10px] text-muted-foreground"><Radio className="h-3.5 w-3.5" />Connect a local model in Settings to begin a real conversation.</div>}
  </div>
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
