begin;
\ir 00_fixtures.inc
select plan(10);

create temp table fx as select pg_temp.mk_branch('basic') a, pg_temp.mk_branch('basic') b;
grant select on fx to anon, authenticated;
insert into public.services(branch_id, name, mode) select a, 'خدمة أ', 'remote' from fx;
insert into public.services(branch_id, name, mode) select b, 'خدمة ب', 'remote' from fx;
select set_config('test.owner_a', pg_temp.owner_of(a)::text, true) from fx;
select set_config('test.pid_a', pg_temp.pid(a), true) from fx;

-- anonymous: no tables, only the public RPCs
set local role anon;
select throws_ok('select count(*) from public.tickets', '42501', null, 'anon cannot read tickets');
select throws_ok('select count(*) from public.businesses', '42501', null, 'anon cannot read businesses');
select throws_ok('select count(*) from public.branches', '42501', null, 'anon cannot read branches');
select throws_ok($$select public.c_join('x', null, null, 1, 'ar', null)$$, '42501', null, 'anon cannot call internal functions');
select ok((public.public_branch(current_setting('test.pid_a')) -> 'branch' ->> 'name') is not null, 'anon can read the public branch RPC');
reset role;

-- owner A sees only their own rows
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.owner_a'), true);
select is((select count(*)::int from public.branches), 1, 'owner sees only their branch');
select is((select count(*)::int from public.services), 1, 'owner sees only their services');
select throws_ok('select redemption_secret from public.branches', '42501', null, 'redemption secret is never readable');
select throws_ok($$update public.businesses set plan = 'full'$$, '42501', null, 'owner cannot change their own plan');
select is((select count(*)::int from public.services where name = 'خدمة ب'), 0, 'owner A cannot read owner B services');
reset role;

select * from finish();
rollback;
