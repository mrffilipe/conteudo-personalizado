export interface ProcessingResult {
  rowId: string;
  success: boolean;
  lead: Record<string, unknown>;
  content?: string;
  error?: string;
  timestamp: string;
  aiModel: string;
  temperature: number;
  index: number;
  scrapedSummary?: string;
}

export interface CheckpointData {
  fileId: string;
  fileName: string;
  createdAt: string;
  updatedAt: string;
  total: number;
  columnsOriginal: string[];
  results: ProcessingResult[];
}
