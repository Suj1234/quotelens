-- 0008_rfx_terms_set.sql — P5-T1. Every term column has a default, so "terms set" can't be read from the values:
-- the co-pilot / Terms tab sets this flag (DESIGN §3.3 status "terms pending" and the Issue precondition).
alter table rfx add column if not exists terms_set boolean not null default false;
-- The seeded RFx were created with their full terms from rfx_meta.json.
update rfx set terms_set = true where code in ('MER-0417', 'MER-0418', 'MER-0419');
