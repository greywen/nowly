export type Permissions = { calendar: boolean; tasks: boolean; external: boolean };
export type Protocol = 'openaiChat' | 'openaiResponses' | 'azure' | 'anthropic' | 'gemini' | 'ollama';
export type AssistantConfig = { endpoint: string; model: string; hasKey: boolean; permissions: Permissions; protocol?: Protocol; apiVersion?: string; detectedEndpoint?: string | null };
export function connectionReady(config: AssistantConfig | null | undefined): boolean {
  if (!config?.model || !config.endpoint) return false;
  if (config.hasKey) return true;
  try {
    const url = new URL(config.endpoint);
    return ['http:', 'https:'].includes(url.protocol) &&
      (url.hostname === 'localhost' || url.hostname === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(url.hostname));
  } catch { return false; }
}
export type EventTarget = { id: string; occurrenceStartAt: string | null };
export type Fields = Record<string, unknown>;
export type Action =
  | { kind: 'createEvent' | 'createTask'; draft: Fields }
  | { kind: 'updateEvent'; target: EventTarget; patch: Fields }
  | { kind: 'deleteEvent'; target: EventTarget }
  | { kind: 'updateTask'; id: string; patch: Fields }
  | { kind: 'deleteTask'; id: string };
export type Change = { key: string; kind: Action['kind']; title: string; before: Fields | null; after: Fields | null };
export type Plan = {
  id: string; status: 'pending' | 'cancelled' | 'expired' | 'committed' | 'undone';
  createdAt: number; expiresAt: number; revision: number;
  actions: Action[]; changes: Change[]; warnings: string[];
  options: { lanes?: { id: string; name: string }[]; completionLaneId?: string; defaultLaneId?: string };
};
export type AssistantRecord = { key: string; domain: 'calendar' | 'tasks'; title: string; source: string; readOnly: boolean; data: Fields };
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
  interpret(request: InterpretRequest): Promise<Reply>;
  cancelRequest(requestId: string): Promise<void>;
  revise(planId: string, actions: Action[]): Promise<Plan>;
  cancelPlan(planId: string): Promise<void>;
  execute(planId: string): Promise<Plan>;
  undo(planId: string): Promise<Plan>;
  history(): Promise<Plan[]>;
  status(planId: string): Promise<Plan>;
};
