-- 接收端在业务写入的同一事务内保存成功响应。长期保留已提交的键，供延迟重试回放。
create table if not exists rpc_idempotency_record
(
    operation_key char(64) primary key,
    request_hash  char(64) not null,
    response_body text,
    created_at    timestamptz not null default current_timestamp
);

comment on column rpc_idempotency_record.operation_key is '服务操作、已验证调用主体和幂等键组成的 SHA-256';
comment on column rpc_idempotency_record.request_hash is '规范化业务请求的 SHA-256';
comment on column rpc_idempotency_record.response_body is '首次成功调用的 JSON 响应，与业务写入同时提交';
