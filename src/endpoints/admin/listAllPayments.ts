import type { Env } from '../../types/Env';
import { verifyAccessToken } from '../../service/tokenVerify';

const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

export async function listAllPaymentsHandler(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'Method Not Allowed' }, 405);
  
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  
  const token = auth.slice(7);
  const { valid, payload } = await verifyAccessToken(env, token, {});
  if (!valid || !payload) return json({ error: 'Unauthorized' }, 401);
  
  // Verificar se o usuário é admin
  if (!payload.roles?.includes('admin')) {
    return json({ error: 'Forbidden - Admin required' }, 403);
  }

  try {
    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 500);
    const offset = Math.max(parseInt(url.searchParams.get('offset') || '0'), 0);
    const status = url.searchParams.get('status');
    const userId = url.searchParams.get('user_id');
    
    let query = `SELECT 
      p.id, p.user_id, p.plan_id, p.amount_cents, p.currency, p.status, p.status_detail,
      p.payment_method, p.installments, p.external_id, p.preference_id, 
      p.processed_at, p.created_at, p.updated_at,
      u.email as user_email, u.first_name, u.last_name
      FROM payments p 
      LEFT JOIN users u ON p.user_id = u.id
      WHERE 1=1`;
    
    const params: string[] = [];
    
    if (status) {
      query += ` AND p.status = ?`;
      params.push(status);
    }
    
    if (userId) {
      query += ` AND p.user_id = ?`;
      params.push(userId);
    }
    
    query += ` ORDER BY p.created_at DESC LIMIT ? OFFSET ?`;
    params.push(String(limit), String(offset));
    
    const rows = await env.DB.prepare(query).bind(...params).all();
    
    // Contar total para paginação
    let countQuery = `SELECT COUNT(*) as total FROM payments p WHERE 1=1`;
    const countParams: string[] = [];
    
    if (status) {
      countQuery += ` AND p.status = ?`;
      countParams.push(status);
    }
    
    if (userId) {
      countQuery += ` AND p.user_id = ?`;
      countParams.push(userId);
    }
    
    const countResult = await env.DB.prepare(countQuery).bind(...countParams).first();
    const total = Number(countResult?.total) || 0;
    
    return json({ 
      ok: true, 
      payments: rows.results,
      pagination: {
        total,
        limit,
        offset,
        has_more: (offset + limit) < total
      }
    });
    
  } catch (e: any) {
    console.error('listAllPayments error:', e);
    return json({ error: 'Internal Error' }, 500);
  }
}