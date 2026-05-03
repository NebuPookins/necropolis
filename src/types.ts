export interface Server {
  id: string;
  name: string;
  myLastMsg: number | null;
  myFirstMsg: number | null;
  myMsgCount: number;
  channelCount: number;
}

export interface ManualEntry {
  care?: number;
  decision?: 'keep' | 'leave' | 'undecided';
  manualActivityAt?: string | null;
  notes?: string;
  updatedAt?: number;
}

export type ManualMap = Record<string, ManualEntry>;

export interface EnrichedServer extends Server {
  manual: ManualEntry;
  deadness: number;
}

export interface ParseResult {
  servers: Server[];
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
