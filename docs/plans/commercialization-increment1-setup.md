# 3DP Agent — 商业化 Increment 1 上线清单

账号(Supabase)+ 托管 LLM + 付费门禁。代码已就绪,这份清单教你**5 步把账号真正打开**。

架构原则:**每一层都可替换** —— 计费抽象成接口(Gumroad → Stripe 只改一层)、模型可切换(deepseek/AMD)、额度原子扣减、RLS 防自升权。

---

## Step 1 — 创建 Supabase 项目

1. 打开 `supabase.com` → Sign in → New project
   - 名称:`3dp-agent`
   - 密码:记好(数据库密码)
   - Region:选 **Singapore / Tokyo**(离中国近,免费层够用)
2. 项目建好后,进入 **Project Settings → API**,复制 4 个值:
   - `Project URL` → 填 `SUPABASE_URL`
   - `anon` public key → 填 `VITE_SUPABASE_ANON_KEY`
   - `service_role` secret key → 填 `SUPABASE_SERVICE_ROLE_KEY`
   - (server 端 SUPABASE_URL 跟 Project URL 一样)

## Step 2 — 跑数据库 SQL

进入 **SQL Editor → New query**,粘贴下面整段,Run:

```sql
-- ============================================================
-- 3DP Agent — profiles + quota + credits
-- 生产级:RLS 防自升权、额度原子扣减、为收款(Increment 2)预留 credits
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
```

> 之后要加新套餐(如 pro_annual):`alter table public.profiles drop constraint profiles_plan_check;` 再重建,一行事。

## Step 3 — 环境变量

### 本地 `.env`(仓库根目录,已 gitignore)

```
# Supabase
SUPABASE_URL=your-project-url
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
VITE_SUPABASE_URL=your-project-url
VITE_SUPABASE_ANON_KEY=your-anon-key

# 托管模型(至少配 DEEPSEEK;其余可选)
DEEPSEEK_API_KEY=sk-xxx
# ANTHROPIC_API_KEY=  OPENAI_API_KEY=  MOONSHOT_API_KEY=  FIREWORKS_API_KEY=  GEMINI_API_KEY=

# 免费用户每月托管调用上限
FREE_MONTHLY_LIMIT=100
```

### Vercel 后台(Project → Settings → Environment Variables)

把上面**全部**变量都加到 Vercel(含 `VITE_` 开头的,构建时需要)。

> ⚠️ `SUPABASE_SERVICE_ROLE_KEY` 和模型 key **绝不能**出现在 `VITE_` 变量里 —— 那是要打包进浏览器的,泄了就完了。

## Step 4 — 重定向白名单

Supabase → **Authentication → URL Configuration → Redirect URLs**,加:

```
https://3dp-agent.vercel.app/**
http://127.0.0.1:3199/**
http://127.0.0.1:3000/**
http://localhost:3000/**
```

(打包版桌面用 3199,本地 dev 用 3000。)

## Step 5 — 部署 + 验证

1. 本地验证:`pnpm dev:server` + `pnpm dev`,注册 → 登录 → Deep Analysis 走托管 key(不用填 key)
2. 部署:`! vercel --prod --yes`
3. 手机验证:注册登录 → 顶栏变「FREE PLAN」徽章 → 深度分析/聊天可用
4. 匿名用户:仍可填自己的 key 用(BYOK 兜底)

---

## 架构为什么"最灵活"

| 设计 | 为什么顶级 |
|---|---|
| **额度原子扣减**(FOR UPDATE RPC) | 并发下不可能超扣,不会烧你钱 |
| **RLS 只读自己** | 用户无法自改 plan/刷积分(安全第一) |
| **BYOK 兜底保留** | 老用户、匿名用户不受影响,零回归 |
| **credits 表 + consume_credits 已备好** | Increment 2 收款直接调,不用改表 |
| **模型可切换** | 默认 deepseek 便宜,以后切 AMD 只改 provider |
| **计费抽象层** | Gumroad(MoR)→ Stripe(香港公司)只换一个实现 |

下一步(Increment 2)就是:接 Gumroad 卖 Pro/积分 → webhook 用 service_role 更新 `profiles.plan` / `profiles.credits`,一切就通了。
