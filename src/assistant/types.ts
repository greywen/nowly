export type Permissions = {
  calendar: boolean; tasks: boolean; external: boolean; notes?: boolean;
  alarms?: boolean;
  /** Lets plans write events into connected Google / Microsoft calendars. Needs `external`. */
  externalWrite?: boolean;
};
export type Protocol = 'openaiChat' | 'openaiResponses' | 'azure' | 'anthropic' | 'gemini' | 'ollama';
export type AssistantConfig = { endpoint: string; model: string; hasKey: boolean; permissions: Permissions; protocol?: Protocol; apiVersion?: string; detectedEndpoint?: string | null };
/** Loopback services may run without a key over plain HTTP. */
export function isLocalEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return ['http:', 'https:'].includes(url.protocol) &&
      (url.hostname === 'localhost' || url.hostname === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(url.hostname));
  } catch { return false; }
}
export function connectionReady(config: AssistantConfig | null | undefined): boolean {
  if (!config?.model || !config.endpoint) return false;
  return config.hasKey || isLocalEndpoint(config.endpoint);
}
export type EventTarget = { id: string; occurrenceStartAt: string | null };
export type Fields = Record<string, unknown>;
export type RemoteTarget = { subscriptionId: string; remoteEventId: string };
export type Action =
  | { kind: 'createEvent' | 'createTask' | 'createNote' | 'createAlarm'; draft: Fields }
  | { kind: 'updateEvent'; target: EventTarget; patch: Fields }
  | { kind: 'deleteEvent'; target: EventTarget }
  | { kind: 'updateTask'; id: string; patch: Fields }
  | { kind: 'deleteTask'; id: string }
  | { kind: 'updateAlarm'; id: string; patch: Fields }
  | { kind: 'deleteAlarm'; id: string }
  | { kind: 'createRemoteEvent'; subscriptionId: string; draft: Fields }
  | { kind: 'updateRemoteEvent'; target: RemoteTarget; patch: Fields }
  /** Retired: stored plans may still carry them, new plans never do. */
  | { kind: 'updateNote'; id: string; patch: Fields }
  | { kind: 'deleteNote'; id: string };
export type Change = { key: string; kind: Action['kind']; title: string; before: Fields | null; after: Fields | null };
export type PlanStatus = 'pending' | 'cancelled' | 'expired' | 'committed' | 'undone' | 'executing' | 'failed' | 'undoing';
export type PlanSource = 'chat' | 'voice' | 'external';
export type Plan = {
  id: string; status: PlanStatus;
  createdAt: number; expiresAt: number; revision: number;
  actions: Action[]; changes: Change[]; warnings: string[];
  options: {
    lanes?: { id: string; name: string }[];
    tags?: { id: string; name: string; color: string; archived: boolean }[];
    categories?: { id: string; name: string; color: string }[];
  };
  source?: PlanSource;
  /** The external agent that proposed the plan, e.g. "Codex". */
  client?: string | null;
};
export type AssistantRecord = { key: string; domain: 'calendar' | 'tasks' | 'notes' | 'alarms'; title: string; source: string; readOnly: boolean; data: Fields };
export type Reply = { kind: 'plan' | 'results' | 'clarify'; message: string; records: AssistantRecord[]; plan: Plan | null };
export type HistoryMessage = { role: 'user' | 'assistant'; content: string };
export type ChatItem =
  | { id: string; kind: 'message'; role: 'user' | 'assistant'; content: string }
  | { id: string; kind: 'records'; records: AssistantRecord[] }
  | { id: string; kind: 'plan'; plan: Plan }
  | { id: string; kind: 'status'; content: string; tone?: 'neutral' | 'error' };
export type InterpretRequest = { requestId: string; message: string; history: HistoryMessage[]; previousPlanId: string | null };
export type AssistantClient = {
  getConfig(): Promise<AssistantConfig>;
  saveConfig(config: AssistantConfig, apiKey: string | null, clearKey: boolean): Promise<AssistantConfig>;
  /** `apiKey` null reuses the key saved for this exact endpoint; '' sends none. */
  listModels(endpoint: string, apiKey: string | null): Promise<string[]>;
  interpret(request: InterpretRequest): Promise<Reply>;
  cancelRequest(requestId: string): Promise<void>;
  revise(planId: string, actions: Action[]): Promise<Plan>;
  cancelPlan(planId: string): Promise<void>;
  execute(planId: string): Promise<Plan>;
  undo(planId: string): Promise<Plan>;
  history(): Promise<Plan[]>;
  status(planId: string): Promise<Plan>;
};
