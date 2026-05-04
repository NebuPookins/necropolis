export interface Server {
  id: string;
  name: string;
  myLastMsg: number | null;
  myFirstMsg: number | null;
  myMsgCount: number;
  channelCount: number;
}

export interface DiscordUser {
  id: string;
  name: string;
  myLastMsg: number | null;
  myMsgCount: number;
  lastMsgId: string | null;
  lastChannelId: string | null;
  lastMsgContent: string | null;
  recentMsgs?: Array<{ ts: number; content: string }>;
}

export interface ManualEntry {
  care?: number;
  decision?: 'keep' | 'leave' | 'undecided';
  manualActivityAt?: string | null;
  name?: string;
  notes?: string;
  updatedAt?: number;
}

export type ManualMap = Record<string, ManualEntry>;

export interface EnrichedServer extends Server {
  manual: ManualEntry;
  deadness: number;
}

export interface EnrichedDiscordUser extends DiscordUser {
  manual: ManualEntry;
  deadness: number;
}

export interface ParseResult {
  servers: Server[];
  users: DiscordUser[];
  issues: string[];
  importedAt: number;
}

export interface ProgressInfo {
  stage: string;
  detail: string;
}

export interface DeadnessTier {
  label: string;
  color: string;
  bg: string;
}
