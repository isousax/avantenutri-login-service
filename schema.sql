-- USERS
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
    email TEXT UNIQUE NOT NULL,
    email_confirmed BOOLEAN DEFAULT FALSE,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'client',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Account Confirm
CREATE TABLE IF NOT EXISTS email_verification_codes (
  user_id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- PROFILES
CREATE TABLE IF NOT EXISTS user_profiles (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
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
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
    user_id TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    revoked BOOLEAN DEFAULT FALSE,
    CONSTRAINT fk_session_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Password reset codes
CREATE TABLE IF NOT EXISTS password_reset_codes (
  user_id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
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

-- Índices (opcionais para leitura rápida)
CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts(email);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip);
CREATE INDEX IF NOT EXISTS idx_login_attempts_global_email ON login_attempts_global(email);

CREATE INDEX IF NOT EXISTS idx_email_verification_expires ON email_verification_codes(expires_at);

CREATE INDEX IF NOT EXISTS idx_password_reset_expires ON password_reset_codes(expires_at);