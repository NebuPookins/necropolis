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
  lastSearchedNotFoundAt?: string | null;
  name?: string;
  notes?: string;
  updatedAt?: number;
}

export type ManualMap = Record<string, ManualEntry>;

export interface EnrichedServer extends Server {
  manual: ManualEntry;
  deadness: number;
}

export interface Factor {
  /** Human-readable label, e.g. "volume", "time", "care", "scale", "not-found". */
  label: string;
  /** Formula expression with symbolic placeholders, e.g. "log(min(msgCount, 10) + 2)". */
  expression: string;
  /** Formula expression with actual values plugged in, e.g. "log(min(528, 10) + 2)". */
  expressionInlined: string;
  /** The numeric value of this factor (so the UI can show it, or skip no-op ×1 factors). */
  value: number;
}

export interface SparkResult {
  /** The final computed score. */
  score: number;
  /** Ordered list of factors multiplied together to produce the score. */
  factors: Factor[];
}

export interface EnrichedDiscordUser extends DiscordUser {
  manual: ManualEntry;
  sparkPotential: SparkResult;
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
