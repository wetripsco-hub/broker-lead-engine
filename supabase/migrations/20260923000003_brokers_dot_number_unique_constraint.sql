-- ON CONFLICT (dot_number) needs a real UNIQUE CONSTRAINT, not the partial
-- unique index added earlier (brokers_dot_number_unique_idx has a WHERE
-- clause, which Postgres can't use for plain ON CONFLICT inference —
-- confirmed on a real run: 42P10 "no unique or exclusion constraint
-- matching the ON CONFLICT specification"). A plain UNIQUE constraint
-- still allows multiple NULLs (NULLs are never considered equal), so this
-- doesn't change behavior for rows without a dot_number.
drop index if exists brokers_dot_number_unique_idx;
alter table brokers add constraint brokers_dot_number_key unique (dot_number);
