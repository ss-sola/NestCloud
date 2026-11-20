/** 草稿表单与按文件名推断共用的发布格式。 */
export const CONFIG_FILE_FORMATS = ['json', 'yaml', 'yml', 'env', 'properties'] as const;

/** PostgreSQL 事务并发冲突，可在重新读取草稿后重试。 */
export const CONFIG_WRITE_CONFLICT_CODES: readonly string[] = ['40001', '40P01'];
