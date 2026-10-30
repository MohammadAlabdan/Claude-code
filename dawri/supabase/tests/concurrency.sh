#!/usr/bin/env bash
# Numbering under real concurrency: 40 parallel connections each add a walk-in to the same branch.
# Expect 40 distinct numbers 1..40 with no gaps. Uses the seeded barber branch's chair-1 device.
set -euo pipefail
DB=${DB:-dawri_test}
dev=f0000000-0000-4000-8000-000000000021
svc=d0000000-0000-4000-8000-000000000021
day=$(psql -X -At -d "$DB" -c "select public.riyadh_today() + 400")
psql -X -q -d "$DB" -c "delete from public.ticket_counters where day = '$day'"
for i in $(seq 1 40); do
  psql -X -At -d "$DB" -c "select public.next_ticket_number('c0000000-0000-4000-8000-000000000002', '$day')" &
done > /tmp/dawri-numbers.$$ ; wait
sort -n /tmp/dawri-numbers.$$ | tr '\n' ' ' > /tmp/dawri-sorted.$$
expected=$(seq 1 40 | tr '\n' ' ')
if [[ "$(cat /tmp/dawri-sorted.$$)" == "$expected" ]]; then echo "concurrency: ok - 40 parallel numbers are 1..40"; rc=0
else echo "concurrency: not ok - got $(cat /tmp/dawri-sorted.$$)"; rc=1; fi
# and 20 parallel walk-ins through the full staff action
for i in $(seq 1 20); do psql -X -At -d "$DB" -c "select public.s_add_walk_in('$dev', '$svc', 1, null) ->> 'number'" & done > /tmp/dawri-walk.$$ ; wait
if [[ $(sort -u /tmp/dawri-walk.$$ | wc -l) -eq 20 ]]; then echo "concurrency: ok - 20 parallel walk-ins got distinct numbers"
else echo "concurrency: not ok - duplicate walk-in numbers"; rc=1; fi
rm -f /tmp/dawri-*.$$
exit $rc
