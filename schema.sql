-- USERS
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY DEFAULT (
    lower(
      hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))
    )
  ),
  email TEXT UNIQUE NOT NULL,
  email_confirmed INTEGER DEFAULT 0,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'patient',
  plan_id TEXT DEFAULT 'free',
  session_version INTEGER NOT NULL DEFAULT 0,
  display_name TEXT,
  last_login_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Account Confirm (email verification tokens stored hashed)
CREATE TABLE IF NOT EXISTS email_verification_codes (
  user_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER DEFAULT 0,
  used_at TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- PROFILES
CREATE TABLE IF NOT EXISTS user_profiles (
  id TEXT PRIMARY KEY DEFAULT (
    lower(
      hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))
    )
  ),
  user_id TEXT NOT NULL,
  full_name TEXT,
  phone TEXT,
  birth_date DATE,
  photo_url TEXT,
  bio TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- SESSIONS
CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY DEFAULT (
    lower(
      hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))
    )
  ),
  user_id TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  revoked INTEGER DEFAULT 0,
  CONSTRAINT fk_session_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Password reset tokens (hashed)
CREATE TABLE IF NOT EXISTS password_reset_codes (
  user_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  used INTEGER DEFAULT 0,
  used_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Tabela por email + IP (bloqueio por par)
CREATE TABLE IF NOT EXISTS login_attempts (
  email TEXT NOT NULL,
  ip TEXT NOT NULL,
  attempts INTEGER DEFAULT 0,
  last_attempt_at TEXT,
  locked_until TEXT,
  PRIMARY KEY(email, ip)
);

-- Tabela global por email (bloqueio independente do IP)
CREATE TABLE IF NOT EXISTS login_attempts_global (
  email TEXT PRIMARY KEY,
  attempts INTEGER DEFAULT 0,
  last_attempt_at TEXT,
  locked_until TEXT
);

-- Audit log de alterações de senha
CREATE TABLE IF NOT EXISTS password_change_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ip TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Revogação de access tokens (lista de JTI) No futuro, adicionar rotina de limpeza para remover revoked_jti cujo expires_At passou. 
CREATE TABLE IF NOT EXISTS revoked_jti (
  jti TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  revoked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reason TEXT,
  expires_at TIMESTAMP,
  -- quando o token expiraria (usado para GC)
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Audit log de alterações de role (admin)
CREATE TABLE IF NOT EXISTS role_change_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  old_role TEXT,
  new_role TEXT NOT NULL,
  changed_by TEXT,
  -- admin user id ou sistema
  reason TEXT,
  changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_users_last_login_at ON users(last_login_at);

-- PLANOS (catálogo)
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY, -- free | self | full
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Capabilities por plano
CREATE TABLE IF NOT EXISTS plan_capabilities (
  plan_id TEXT NOT NULL,
  capability_code TEXT NOT NULL,
  PRIMARY KEY(plan_id, capability_code),
  FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE
);

-- Limites numéricos por plano
CREATE TABLE IF NOT EXISTS plan_limits (
  plan_id TEXT NOT NULL,
  limit_key TEXT NOT NULL,
  limit_value INTEGER NOT NULL,
  PRIMARY KEY(plan_id, limit_key),
  FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE
);

-- Contadores de uso por período (YYYY-MM)
CREATE TABLE IF NOT EXISTS user_usage_counters (
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value INTEGER NOT NULL DEFAULT 0,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  PRIMARY KEY(user_id, key, period_start),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Índices (leitura rápida)
CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts(email);

CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip);

CREATE INDEX IF NOT EXISTS idx_login_attempts_global_email ON login_attempts_global(email);

CREATE INDEX IF NOT EXISTS idx_email_verification_token_hash ON email_verification_codes(token_hash);

CREATE INDEX IF NOT EXISTS idx_email_verification_expires ON email_verification_codes(expires_at);

CREATE INDEX IF NOT EXISTS idx_password_reset_token_hash ON password_reset_codes(token_hash);

CREATE INDEX IF NOT EXISTS idx_password_reset_expires ON password_reset_codes(expires_at);

CREATE INDEX IF NOT EXISTS idx_role_change_user ON role_change_log(user_id);

CREATE INDEX IF NOT EXISTS idx_revoked_jti_user ON revoked_jti(user_id);

CREATE INDEX IF NOT EXISTS idx_password_change_user ON password_change_log(user_id);

-- =====================
-- BLOG POSTS (conteúdo público / marketing)
-- =====================
CREATE TABLE IF NOT EXISTS blog_posts (
  id TEXT PRIMARY KEY DEFAULT (
    lower(
      hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))
    )
  ),
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  excerpt TEXT,
  content_html TEXT NOT NULL,
  author_name TEXT,
  author_id TEXT,
  category TEXT,
  tags_csv TEXT,
  cover_image_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft', -- draft | published | archived
  read_time_min INTEGER,
  published_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- View counts (separated to avoid write amplification on main row)
CREATE TABLE IF NOT EXISTS blog_post_views (
  post_id TEXT PRIMARY KEY,
  views INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES blog_posts(id) ON DELETE CASCADE
);

-- (Future migration) To support Markdown storage, add column content_md TEXT nullable.
-- ALTER TABLE blog_posts ADD COLUMN content_md TEXT;  -- executed manually when deploying migration.

CREATE INDEX IF NOT EXISTS idx_blog_posts_status_published_at ON blog_posts(status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_blog_posts_category ON blog_posts(category);
CREATE INDEX IF NOT EXISTS idx_blog_posts_title ON blog_posts(title);

-- Seed básico (idempotente)
INSERT OR IGNORE INTO plans (id, name, price_cents) VALUES
 ('free','Free',0),
 ('self','Self-Managed',4900),
 ('full','Full Care',14900);

-- Capabilities (ajustar conforme evolução) - DIETA_EDIT etc.
INSERT OR IGNORE INTO plan_capabilities (plan_id, capability_code) VALUES
 ('free','AGUA_LOG'),
 ('free','DIETA_VIEW'),
 ('free','RELATORIO_DOWNLOAD'),
 ('free','PESO_LOG'),
 ('free','REFEICAO_LOG'),
 ('self','AGUA_LOG'),
 ('self','DIETA_VIEW'),
 ('self','DIETA_EDIT'),
 ('self','CONSULTA_AGENDAR'),
 ('self','RELATORIO_DOWNLOAD'),
 ('self','PESO_LOG'),
  ('self','REFEICAO_LOG'),
 ('full','AGUA_LOG'),
 ('full','DIETA_VIEW'),
 ('full','DIETA_EDIT'),
 ('full','CONSULTA_AGENDAR'),
 ('full','CONSULTA_CANCELAR'),
 ('full','CHAT_NUTRI'),
 ('full','RELATORIO_DOWNLOAD'),
 ('full','PESO_LOG'),
 ('full','REFEICAO_LOG');

-- Limites por plano (ex: revisões de dieta/mês, consultas incluídas)
INSERT OR IGNORE INTO plan_limits (plan_id, limit_key, limit_value) VALUES
 ('free','DIETA_REVISOES_MES',0),
 ('self','DIETA_REVISOES_MES',1),
 ('full','DIETA_REVISOES_MES',2),
 ('free','CONSULTAS_INCLUIDAS_MES',0),
 ('self','CONSULTAS_INCLUIDAS_MES',0),
 ('full','CONSULTAS_INCLUIDAS_MES',1),
 -- Limite diário de água (ml) por plano (exemplo: free 1500ml, self 2500ml, full 3000ml)
 ('free','WATER_ML_DIA',1500),
 ('self','WATER_ML_DIA',2500),
 ('full','WATER_ML_DIA',3000);

-- =====================
-- DIET PLANS (Plano alimentar do usuário)
-- =====================
CREATE TABLE IF NOT EXISTS diet_plans (
  id TEXT PRIMARY KEY DEFAULT (
    lower(
      hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))
    )
  ),
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active', -- active | archived
  start_date DATE,
  end_date DATE,
  current_version_id TEXT,
  results_summary TEXT, -- resumo últimos resultados visíveis no dashboard
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS diet_plan_versions (
  id TEXT PRIMARY KEY DEFAULT (
    lower(
      hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))
    )
  ),
  plan_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  generated_by TEXT NOT NULL DEFAULT 'user', -- user | auto | nutri
  data_json TEXT NOT NULL, -- estrutura do plano (refeições, macros) em JSON
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (plan_id) REFERENCES diet_plans(id) ON DELETE CASCADE,
  UNIQUE(plan_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_diet_plans_user ON diet_plans(user_id);
CREATE INDEX IF NOT EXISTS idx_diet_plan_versions_plan ON diet_plan_versions(plan_id);

-- =====================
-- WATER LOGS (Registro de água ingerida)
-- =====================
CREATE TABLE IF NOT EXISTS water_logs (
  id TEXT PRIMARY KEY DEFAULT (
    lower(
      hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))
    )
  ),
  user_id TEXT NOT NULL,
  log_date DATE NOT NULL, -- YYYY-MM-DD (UTC)
  amount_ml INTEGER NOT NULL, -- quantidade em mililitros
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_water_logs_user_date ON water_logs(user_id, log_date);

-- =====================
-- WATER GOALS (Meta diária de copos de água)
-- =====================
CREATE TABLE IF NOT EXISTS user_water_goals (
  user_id TEXT PRIMARY KEY,
  daily_cups INTEGER NOT NULL, -- número de copos (250ml) por dia
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- =====================
-- WATER SETTINGS (tamanho do copo em ml por usuário)
-- =====================
CREATE TABLE IF NOT EXISTS user_water_settings (
  user_id TEXT PRIMARY KEY,
  cup_ml INTEGER NOT NULL DEFAULT 250, -- tamanho do copo usado para conversões
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- =====================
-- WEIGHT LOGS (Registro de peso corporal)
-- =====================
CREATE TABLE IF NOT EXISTS weight_logs (
  id TEXT PRIMARY KEY DEFAULT (
    lower(
      hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))
    )
  ),
  user_id TEXT NOT NULL,
  log_date DATE NOT NULL, -- YYYY-MM-DD (UTC)
  weight_kg REAL NOT NULL, -- peso em kg (duas casas decimais)
  note TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, log_date) -- um registro por dia
);

CREATE INDEX IF NOT EXISTS idx_weight_logs_user_date ON weight_logs(user_id, log_date);

-- =====================
-- USER GOALS (Metas de usuário - peso)
-- =====================
CREATE TABLE IF NOT EXISTS user_goals (
  user_id TEXT PRIMARY KEY,
  weight_goal_kg REAL, -- meta de peso desejado
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- =====================
-- MEAL LOGS (Registro de refeições)
-- =====================
CREATE TABLE IF NOT EXISTS meal_logs (
  id TEXT PRIMARY KEY DEFAULT (
    lower(
      hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))
    )
  ),
  user_id TEXT NOT NULL,
  log_datetime TEXT NOT NULL, -- ISO UTC (YYYY-MM-DDTHH:MM:SSZ)
  log_date DATE NOT NULL, -- derivado para agregações diárias
  meal_type TEXT NOT NULL, -- breakfast | lunch | dinner | snack | other
  description TEXT,
  calories INTEGER, -- kcal estimadas
  protein_g REAL,
  carbs_g REAL,
  fat_g REAL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_meal_logs_user_date ON meal_logs(user_id, log_date);

-- =====================
-- MEAL GOALS (Metas diárias de macros/calorias para refeições)
-- =====================
CREATE TABLE IF NOT EXISTS meal_goals (
  user_id TEXT PRIMARY KEY,
  calories_goal_kcal INTEGER, -- meta diária de calorias
  protein_goal_g REAL, -- meta diária de proteína (g)
  carbs_goal_g REAL, -- meta diária de carboidratos (g)
  fat_goal_g REAL, -- meta diária de gorduras (g)
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- =====================
-- CONSULTATIONS (Agendamentos de consultas)
-- =====================
CREATE TABLE IF NOT EXISTS consultations (
  id TEXT PRIMARY KEY DEFAULT (
    lower(
      hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))
    )
  ),
  user_id TEXT NOT NULL,
  type TEXT NOT NULL, -- acompanhamento | reavaliacao | outro
  status TEXT NOT NULL DEFAULT 'scheduled', -- scheduled | canceled | completed
  scheduled_at TEXT NOT NULL, -- ISO UTC datetime
  duration_min INTEGER NOT NULL DEFAULT 40,
  urgency TEXT, -- baixa | normal | alta
  notes TEXT,
  canceled_at TEXT,
  canceled_reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_consultations_user_time ON consultations(user_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_consultations_status_time ON consultations(status, scheduled_at);

-- =====================
-- CONSULTATION AVAILABILITY (Admin-defined recurring and ad-hoc slots)
-- =====================
CREATE TABLE IF NOT EXISTS consultation_availability_rules (
  id TEXT PRIMARY KEY DEFAULT (
    lower(
      hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))
    )
  ),
  weekday INTEGER NOT NULL, -- 0=Sunday ... 6=Saturday
  start_time TEXT NOT NULL, -- HH:MM (24h, local policy UTC or configurable)
  end_time TEXT NOT NULL,   -- HH:MM exclusive end
  slot_duration_min INTEGER NOT NULL DEFAULT 40,
  max_parallel INTEGER NOT NULL DEFAULT 1, -- future use (parallel sessions)
  active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS consultation_blocked_slots (
  id TEXT PRIMARY KEY DEFAULT (
    lower(
      hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))
    )
  ),
  slot_start TEXT NOT NULL, -- ISO datetime UTC of slot start
  slot_end TEXT NOT NULL,   -- ISO datetime UTC of slot end
  reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_consultation_avail_weekday ON consultation_availability_rules(weekday);
CREATE INDEX IF NOT EXISTS idx_consultation_blocked_slot_start ON consultation_blocked_slots(slot_start);

-- =====================
-- QUESTIONNAIRE (Questionário inicial do paciente)
-- =====================
CREATE TABLE IF NOT EXISTS questionnaire_responses (
  user_id TEXT PRIMARY KEY,
  step_count INTEGER DEFAULT 0,
  category TEXT,
  answers_json TEXT NOT NULL DEFAULT '{}',
  submitted_at TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- =====================
-- PAYMENTS (Mercado Pago / future providers)
-- =====================
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY DEFAULT (
    lower(
      hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))
    )
  ),
  user_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  provider TEXT NOT NULL, -- e.g. MERCADOPAGO
  external_id TEXT, -- payment id from provider
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'BRL',
  status TEXT NOT NULL DEFAULT 'initialized', -- initialized | pending | approved | rejected | refunded | cancelled
  status_detail TEXT,
  idempotency_key TEXT, -- used for provider API idempotency
  raw_payload_json TEXT, -- last provider payload (compact JSON)
  processed_at TIMESTAMP, -- when we applied plan upgrade/downgrade
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_external ON payments(external_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

-- =====================
-- PLAN CHANGE LOG (auditoria de upgrades/downgrades)
-- =====================
CREATE TABLE IF NOT EXISTS plan_change_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  old_plan_id TEXT,
  new_plan_id TEXT NOT NULL,
  reason TEXT NOT NULL, -- payment | admin | downgrade | refund
  payment_id TEXT, -- nullable link to payments.id
  meta_json TEXT, -- extra context (JSON)
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_plan_change_user ON plan_change_log(user_id);
CREATE INDEX IF NOT EXISTS idx_plan_change_payment ON plan_change_log(payment_id);

-- =====================
-- ENTITLEMENT OVERRIDES (capability grants / revokes / limit set per user)
-- =====================
CREATE TABLE IF NOT EXISTS user_entitlement_overrides (
  id TEXT PRIMARY KEY DEFAULT (
    lower(
      hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))
    )
  ),
  user_id TEXT NOT NULL,
  type TEXT NOT NULL, -- capability-grant | capability-revoke | limit-set
  key TEXT NOT NULL,  -- capability code or limit key
  value INTEGER, -- for limit-set (nullable -> interpretado como infinito)
  expires_at TIMESTAMP, -- nullable -> permanente até remoção
  reason TEXT,
  created_by TEXT, -- admin user id
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_ent_override_user ON user_entitlement_overrides(user_id);
CREATE INDEX IF NOT EXISTS idx_ent_override_expires ON user_entitlement_overrides(expires_at);

-- Versionamento de entitlements (separado para não invalidar sessões)
CREATE TABLE IF NOT EXISTS user_entitlements_version (
  user_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Audit log de alterações de overrides (create/delete)
CREATE TABLE IF NOT EXISTS user_entitlement_override_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  override_id TEXT,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL, -- create | delete
  snapshot_json TEXT, -- JSON do override no momento da ação
  created_by TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_ent_override_log_user ON user_entitlement_override_log(user_id);