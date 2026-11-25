/** MTR line metadata, shared with the server aggregator via ../../shared/lines.json. */
import sharedLines from '../../shared/lines.json';

export interface LineInfo {
  code: string;
  nameTc: string;
  nameEn: string;
  color: string;
  stations: string[];
}

export const LINES: LineInfo[] = sharedLines as LineInfo[];

export const LINE_BY_CODE: Record<string, LineInfo> = Object.fromEntries(
  LINES.map((line) => [line.code, line])
);
