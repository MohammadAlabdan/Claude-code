begin;
\ir 00_fixtures.inc
select plan(16);

create temp table fx as select pg_temp.mk_branch('full') br;
alter table fx add column svc uuid, add column dev uuid;
update fx set svc = pg_temp.mk_service(br), dev = pg_temp.mk_device(br);

-- numbering: sequential per branch per Riyadh day
select is(public.next_ticket_number(br, '2030-01-01'), 1, 'first number of a day is 1') from fx;
select is(public.next_ticket_number(br, '2030-01-01'), 2, 'numbers are sequential') from fx;
select is(public.next_ticket_number(br, '2030-01-02'), 1, 'a new day starts again at 1') from fx;

-- four walk-ins: positions 0..3
create temp table tk(n int, id uuid);
insert into tk select g, (public.s_add_walk_in(dev, svc, 1, null) ->> 'ticket_id')::uuid from fx, generate_series(1, 4) g;
select is(array_agg(public.ticket_position(id) order by n), array[0,1,2,3], 'positions follow arrival order') from tk;
select is(array_agg((select number from public.tickets t where t.id = tk.id) order by n), array[1,2,3,4],
          'ticket numbers have no gaps') from tk;

-- priority jumps to the front of the waiting line
select is(public.s_set_priority(dev, (select id from tk where n = 4), 'elderly') ->> 'ok', 'true', 'priority accepted') from fx;
select is(public.ticket_position((select id from tk where n = 4)), 0, 'priority ticket is first');
select is(public.ticket_position((select id from tk where n = 1)), 1, 'others move back one');

-- staff push-back moves a ticket behind two others, second time becomes no-show
select is(public.s_push_back(dev, (select id from tk where n = 1)) ->> 'status', 'waiting', 'first push-back keeps waiting') from fx;
select is(public.ticket_position((select id from tk where n = 1)), 3, 'pushed back behind two tickets');
select is(public.s_push_back(dev, (select id from tk where n = 1)) ->> 'status', 'no_show', 'second push-back is a no-show') from fx;

-- call_next takes the priority ticket, then the earliest
select is((public.s_call_next(dev, null, null) -> 'ticket' ->> 'number')::int, 4, 'call_next serves priority first') from fx;
select is((public.s_call_next(dev, null, null) -> 'ticket' ->> 'number')::int, 2, 'then the earliest waiting') from fx;
select is((select status from public.tickets where id = (select id from tk where n = 4)), 'done',
          'calling the next one finishes the previous call');

-- estimate: one ticket ahead × 10 min ÷ 1 provider = 10
select is(public.ticket_estimate((select id from tk where n = 3)), 5, 'nobody ahead → minimum 5 minutes');
select is(public.round_estimate(13), 15, 'estimates round to the nearest 5');

select * from finish();
rollback;
