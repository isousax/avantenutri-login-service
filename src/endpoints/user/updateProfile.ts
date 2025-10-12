import type { Env } from "../../types/Env";
import { verifyAccessToken } from "../../service/tokenVerify";
import { requireAdmin } from "../../middleware/requireAdmin";
import { generateJWT } from "../../service/generateJWT";
import { invalidateUserListCache } from "../../cache/userListCache";
import { normalizePhone, phoneErrorMessage } from "../../utils/normalizePhone";

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

interface Body {
  display_name?: string;
  full_name?: string;
  phone?: string | null;
  birth_date?: string | null;
  height?: number | null; // altura em centímetros
  user_id?: string; // admin pode atualizar outro usuário
}

export async function updateProfileHandler(
  request: Request,
  env: Env
): Promise<Response> {
  if (request.method !== "PATCH")
    return json({ error: "Method Not Allowed" }, 405);
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return json({ error: "Unauthorized" }, 401);
  const { valid, payload } = await verifyAccessToken(env, token, {
    issuer: env.SITE_DNS,
    audience: env.SITE_DNS,
  });
  if (!valid || !payload?.sub) return json({ error: "Unauthorized" }, 401);
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const requesterUserId = payload.sub as string;
  let targetUserId = requesterUserId;
  if (body.user_id && body.user_id !== requesterUserId) {
    const adminCheck = await requireAdmin(request, env);
    if (!adminCheck.ok && 'response' in adminCheck) return adminCheck.response;
    if (body.user_id.length < 8) return json({ error: 'Invalid user_id' }, 400);
    targetUserId = body.user_id;
  }
  const displayName = body.display_name?.trim();
  const fullName = body.full_name?.trim();

  // Limites de tamanho / validações básicas
  if (displayName && displayName.length > 60)
    return json({ error: "display_name_too_long", max: 60 }, 400);
  if (fullName && fullName.length > 120)
    return json({ error: "full_name_too_long", max: 120 }, 400);
  if (displayName && /[\n\r\t]/.test(displayName))
    return json({ error: "display_name_invalid_chars" }, 400);
  if (fullName && /[\n\r\t]/.test(fullName))
    return json({ error: "full_name_invalid_chars" }, 400);
  const phoneRaw = typeof body.phone === 'string' ? body.phone.trim() : undefined;
  const birthDateRaw = typeof body.birth_date === 'string' ? body.birth_date.trim() : undefined;
  const heightRaw = body.height;

  let normalizedPhone: string | undefined;
  let wantPhoneChange = false;
  let birthDate: string | null | undefined;
  let wantBirthDateChange = false;
  let height: number | null | undefined;
  let wantHeightChange = false;
  if (phoneRaw !== undefined) {
    if (phoneRaw === '') {
      // Interpretar string vazia como remoção (null)
      normalizedPhone = '';
      wantPhoneChange = true;
    } else {
      const norm = normalizePhone(phoneRaw, 'BR');
      if (!norm.ok || !norm.normalized) {
        return json({ error: phoneErrorMessage(norm.reason) }, 400);
      }
      normalizedPhone = norm.normalized;
      wantPhoneChange = true;
    }
  }

  // Validação de birth_date
  if (birthDateRaw !== undefined) {
    if (birthDateRaw === '') {
      // String vazia = remoção (null)
      birthDate = null;
      wantBirthDateChange = true;
    } else {
      // Validar formato YYYY-MM-DD
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(birthDateRaw)) {
        return json({ error: "birth_date_invalid_format" }, 400);
      }
      
      // Validar se é uma data válida
      const date = new Date(birthDateRaw);
      if (isNaN(date.getTime()) || date.toISOString().substring(0, 10) !== birthDateRaw) {
        return json({ error: "birth_date_invalid" }, 400);
      }
      
      // Validar se não é no futuro
      const today = new Date();
      if (date > today) {
        return json({ error: "birth_date_future" }, 400);
      }
      
      // Validar idade mínima (por exemplo, 10 anos)
      const minDate = new Date();
      minDate.setFullYear(minDate.getFullYear() - 120); // máximo 120 anos
      if (date < minDate) {
        return json({ error: "birth_date_too_old" }, 400);
      }
      
      birthDate = birthDateRaw;
      wantBirthDateChange = true;
    }
  }

  // Validação de height (altura em centímetros)
  if (heightRaw !== undefined) {
    if (heightRaw === null) {
      // null = remoção
      height = null;
      wantHeightChange = true;
    } else if (typeof heightRaw === 'number') {
      // Validar se está em uma faixa razoável (50cm a 300cm)
      if (heightRaw < 50 || heightRaw > 300) {
        return json({ error: "height_invalid_range", min: 50, max: 300 }, 400);
      }
      
      // Validar se é um número inteiro positivo
      if (!Number.isInteger(heightRaw) || heightRaw <= 0) {
        return json({ error: "height_must_be_positive_integer" }, 400);
      }
      
      height = heightRaw;
      wantHeightChange = true;
    } else {
      return json({ error: "height_invalid_type" }, 400);
    }
  }

  if (!displayName && !fullName && !wantPhoneChange && !wantBirthDateChange && !wantHeightChange) return json({ error: "No changes" }, 400);
  try {
    // Detectar mudanças
    const existing = await env.DB.prepare(
      "SELECT display_name, session_version FROM users WHERE id = ?"
    )
      .bind(targetUserId)
      .first<{ display_name?: string; session_version?: number }>();
    const profile = await env.DB.prepare(
      "SELECT full_name, phone, birth_date, height FROM user_profiles WHERE user_id = ?"
    )
  .bind(targetUserId)
      .first<{ full_name?: string; phone?: string | null; birth_date?: string | null; height?: number | null }>();
  let updateUser = false;
  let updateProfileName = false;
  let updateProfilePhone = false;
  let updateProfileBirthDate = false;
  let updateProfileHeight = false;
    if (displayName && displayName !== existing?.display_name)
      updateUser = true;
    if (fullName && fullName !== profile?.full_name) updateProfileName = true;
    if (wantPhoneChange) {
      const currentPhone = profile?.phone || null;
      // Normalização resultou em '' => remoção
      if (normalizedPhone === '') {
        if (currentPhone !== null && currentPhone !== '') updateProfilePhone = true;
      } else if (normalizedPhone && normalizedPhone !== currentPhone) {
        updateProfilePhone = true;
      }
    }
    if (wantBirthDateChange) {
      const currentBirthDate = profile?.birth_date || null;
      if (birthDate !== currentBirthDate) {
        // Validação especial: se já existe birth_date, não permitir alteração
        if (currentBirthDate !== null && currentBirthDate !== '') {
          return json({ error: "birth_date_already_set" }, 400);
        }
        updateProfileBirthDate = true;
      }
    }
    if (wantHeightChange) {
      const currentHeight = profile?.height || null;
      if (height !== currentHeight) {
        updateProfileHeight = true;
      }
    }
    if (!updateUser && !updateProfileName && !updateProfilePhone && !updateProfileBirthDate && !updateProfileHeight)
      return json({ success: true, unchanged: true });
    if (updateUser) {
      await env.DB.prepare(
        "UPDATE users SET display_name = ?, session_version = session_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      )
  .bind(displayName, targetUserId)
        .first();
    }
    if (updateProfileName || updateProfilePhone || updateProfileBirthDate || updateProfileHeight) {
      const hasProfile = !!profile;
      if (hasProfile) {
        // Construir SET dinâmico
        const sets: string[] = [];
        const binds: any[] = [];
        if (updateProfileName) {
          sets.push("full_name = ?");
          binds.push(fullName);
        }
        if (updateProfilePhone) {
          sets.push("phone = ?");
          binds.push(normalizedPhone === '' ? null : normalizedPhone);
        }
        if (updateProfileBirthDate) {
          sets.push("birth_date = ?");
          binds.push(birthDate);
        }
        if (wantHeightChange) {
          sets.push("height = ?");
          binds.push(height);
        }
        sets.push("updated_at = CURRENT_TIMESTAMP");
  binds.push(targetUserId);
        await env.DB.prepare(
          `UPDATE user_profiles SET ${sets.join(", ")} WHERE user_id = ?`
        )
          .bind(...binds)
          .first();
      } else {
        // Inserir novo profile (apenas campos fornecidos)
        await env.DB.prepare(
          "INSERT INTO user_profiles (user_id, full_name, phone, birth_date, height, created_at, updated_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        )
          .bind(
            targetUserId,
            fullName || null,
            normalizedPhone === '' ? null : normalizedPhone || null,
            birthDate || null,
            height || null
          )
          .first();
      }
    }
    // Invalidate list users cache so admin listing reflects new name
  if (updateUser || updateProfileName || updateProfilePhone || updateProfileBirthDate || updateProfileHeight) invalidateUserListCache();
    let access_token: string | undefined;
    let newSessionVersion: number | undefined;
    const updatedSelf = targetUserId === requesterUserId;
    if (updatedSelf && (updateUser || updateProfilePhone || updateProfileName || updateProfileBirthDate)) {
      // Emitir novo token com session_version e display_name atualizados
      const row = await env.DB.prepare(
        `SELECT u.id, u.email, u.role, u.session_version, u.display_name, p.full_name, p.phone, p.birth_date
        FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id WHERE u.id = ?`
      )
  .bind(targetUserId)
        .first<any>();
      if (row && env.JWT_SECRET) {
        const expSec = env.JWT_EXPIRATION_SEC
          ? Number(env.JWT_EXPIRATION_SEC)
          : 3600;
        newSessionVersion = row.session_version;
        access_token = await generateJWT(
          {
            sub: row.id,
            email: row.email,
            role: row.role,
            session_version: row.session_version,
            display_name: row.display_name ?? undefined,
            full_name: row.full_name ?? undefined,
            phone: row.phone ?? undefined,
            birth_date: row.birth_date ?? undefined,
            iss: env.SITE_DNS,
            aud: env.SITE_DNS,
          },
          env.JWT_SECRET,
          expSec,
          env.JWT_PRIVATE_KEY_PEM
            ? {
                privateKeyPem: env.JWT_PRIVATE_KEY_PEM,
                kid: env.JWT_JWKS_KID || "k1",
              }
            : undefined
        );
      }
    }
    let resp: any = { success: true };
    if (access_token) {
      resp.access_token = access_token;
      resp.token_type = "Bearer";
      resp.display_name = displayName || existing?.display_name || null;
      if (newSessionVersion !== undefined) resp.session_version = newSessionVersion;
    } else if (updatedSelf && (updateUser || updateProfileName || updateProfilePhone || updateProfileBirthDate)) {
      // Situação improvável: self update sem token novo
      resp.need_new_token = true;
    }
    if (targetUserId !== requesterUserId) {
      resp.updated_user_id = targetUserId;
    }
    return json(resp);
  } catch (err: any) {
    return json({ error: "Internal Error", detail: err?.message }, 500);
  }
}
