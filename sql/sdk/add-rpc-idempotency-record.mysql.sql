-- 业务表与幂等记录均须使用 InnoDB，并在同一事务内写入。
create table if not exists rpc_idempotency_record
(
    operation_key char(64) character set ascii collate ascii_bin not null comment '操作、调用主体和幂等键的 SHA-256',
    request_hash  char(64) character set ascii collate ascii_bin not null comment '规范化业务请求的 SHA-256',
    response_body longtext comment '与首次业务写入同时提交的 JSON 响应',
    created_at    timestamp(6) not null default current_timestamp(6),
    primary key (operation_key)
) engine = InnoDB default character set = utf8mb4;
