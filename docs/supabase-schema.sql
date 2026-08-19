-- ============================================================
-- 3DP Agent — profiles + quota + credits
-- 生产级:RLS 防自升权、额度原子扣减、为收款(Increment 2)预留 credits
-- 使用方法:Supabase Dashboard → SQL Editor → New query → 全选粘贴 → Run
-- ============================================================

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  plan        text not null default 'free' check (plan in ('free','pro')),
  usage_count integer not null default 0,      -- 本月托管 LLM 调用次数
  quota_month text,                            -- usage_count 所属月份 'YYYY-MM'
  credits     integer not null default 0,      -- 预充积分(Increment 2 收款用)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- RLS:客户端只能读自己,无 UPDATE → 用户无法把自己改成 pro / 给自己加积分
alter table public.profiles enable row level security;
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (auth.uid() = id);

-- updated_at 自动刷新
create or replace function public.touch_updated_at()
returns trigger language plpgsql security definer set search_path = public as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles for each row execute function public.touch_updated_at();

-- 注册即建 profile
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- 原子扣月度额度(FOR UPDATE + 单语句 → 并发不超扣);返回剩余次数,0=超限
create or replace function public.consume_usage(p_user uuid, p_limit integer)
returns integer language plpgsql security definer set search_path = public as $$
declare v_month text := to_char(now(), 'YYYY-MM'); v_row public.profiles%rowtype; begin
  select * into v_row from public.profiles where id = p_user for update;
  if v_row.id is null then
    insert into public.profiles (id, quota_month) values (p_user, v_month) returning * into v_row;
  end if;
  if v_row.quota_month is distinct from v_month then
    update public.profiles set usage_count = 0, quota_month = v_month
      where id = p_user returning usage_count into v_row.usage_count;
    v_row.quota_month := v_month;
  end if;
  if v_row.usage_count >= p_limit then return 0; end if;
  update public.profiles set usage_count = usage_count + 1 where id = p_user;
  return greatest(0, p_limit - (v_row.usage_count + 1));
end $$;

-- 原子扣积分(给 Increment 2 收款用的,现在就跑好,以后直接调)
create or replace function public.consume_credits(p_user uuid, p_amount integer)
returns integer language plpgsql security definer set search_path = public as $$
declare v_row public.profiles%rowtype; begin
  select * into v_row from public.profiles where id = p_user for update;
  if v_row.id is null then return 0; end if;
  if v_row.credits < p_amount then return v_row.credits; end if;
  update public.profiles set credits = credits - p_amount where id = p_user;
  return v_row.credits - p_amount;
end $$;

-- 显式授权(放最后,函数建好后才能 GRANT)
grant select on public.profiles to anon, authenticated;
grant execute on function public.consume_usage to authenticated, service_role;
grant execute on function public.consume_credits to authenticated, service_role;
