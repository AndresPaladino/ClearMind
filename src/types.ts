export interface Entry {
  id: string;
  date: string;
  number: number;
  content: string;
  sealed: boolean;
}

export interface EntrySummary {
  id: string;
  date: string;
  number: number;
  sealed: boolean;
  tags: string[];
}
