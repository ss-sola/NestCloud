/** 配置中心 HTTP 响应中的时间戳以 JSON 字符串传输。 */
export interface ConfigSnapshot {
  id: number;
  name: string;
  format: string;
  content: string;
  description?: string | null;
  md5: string;
  version: number;
  isPublished: boolean;
  publishedAt?: string | null;
  updatedAt: string;
}

export interface ConfigAggregate {
  name: string;
  currentDraft: ConfigSnapshot | null;
  latestPublished: ConfigSnapshot | null;
  activeRecord: ConfigSnapshot | null;
  updatedAt?: string;
}

export interface ConfigSummary {
  nameCount: number;
  publishedCount: number;
  draftCount: number;
}

export interface ConfigPage {
  list: ConfigAggregate[];
  total: number;
  summary?: ConfigSummary;
}

export interface ConfigQuery {
  pageNum: number;
  pageSize: number;
  search: string;
  published: string;
  format: string;
}

export interface ConfigEditor {
  dispose(): void;
  getModel(): object | null;
  getValue(): string;
  setValue(value: string): void;
}

export interface ConfigModal {
  show(): void;
  hide(): void;
}
