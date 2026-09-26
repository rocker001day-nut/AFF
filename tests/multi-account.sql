-- Transaction-scoped fixtures; nothing is retained after the test.
begin;
do $$
declare a uuid; b uuid; c uuid; result jsonb;
begin
 insert into public.affiliate_accounts(platform,label,external_account_id) values ('shopee','Test A',gen_random_uuid()::text) returning id into a;
 insert into public.affiliate_accounts(platform,label,external_account_id) values ('shopee','Test B',gen_random_uuid()::text) returning id into b;
 insert into public.affiliate_accounts(platform,label,external_account_id) values ('lazada','Test C',gen_random_uuid()::text) returning id into c;
 insert into public.affiliate_conversions(platform,account_id,external_order_id,dedup_key,commission,sub_id2,status_normalized,purchase_date_bkk)
 values ('shopee',a,'same-order',a::text,10,'TEST-SUP','completed','2099-01-01'),
 ('shopee',b,'same-order',b::text,20,'test-sup','validated','2099-01-01'),
 ('lazada',c,'same-order',c::text,30,'TEST-SUP','pending','2099-01-01'),
 ('lazada',c,'cancelled',gen_random_uuid()::text,999,'TEST-SUP','cancelled','2099-01-01');
 result:=public.affiliate_dashboard('2099-01-01','2099-01-01');
 if (result#>>'{totals,shopee}')::numeric<>30 or (result#>>'{totals,lazada}')::numeric<>30 or (result#>>'{totals,orders}')::int<>3 then raise exception 'Combined totals failed: %',result; end if;
 if jsonb_array_length(result->'rows')<>1 then raise exception 'SUP grouping failed'; end if;
 result:=public.affiliate_dashboard('2099-01-01','2099-01-01','shopee',a);
 if (result#>>'{totals,shopee}')::numeric<>10 or (result#>>'{totals,orders}')::int<>1 then raise exception 'Account filter failed'; end if;
 result:=public.affiliate_dashboard('2099-01-02','2099-01-02');
 if (result#>>'{totals,orders}')::int<>0 then raise exception 'Date filter failed'; end if;
 if has_function_privilege('anon','public.affiliate_dashboard(date,date,text,uuid)','execute') then raise exception 'Anonymous access allowed'; end if;
end $$;
select 'PASS: combined totals, account identity, SUP grouping, date filters, anonymous access' as result;
rollback;
