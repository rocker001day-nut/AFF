const { createClient } = require('@supabase/supabase-js');

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing server environment variable: ${name}`);
  return value;
}

function serviceClient() {
  const url = process.env.SUPABASE_URL || 'https://txbsrtunejnqaheuohck.supabase.co';
  const key = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

function bearerToken(req) {
  const value = String(req.headers.authorization || '');
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

async function requireTeamMember(req) {
  const token = bearerToken(req);
  if (!token) {
    const error = new Error('กรุณาเข้าสู่ระบบก่อนใช้งาน Auto Sync');
    error.statusCode = 401;
    error.code = 'missing_bearer_token';
    throw error;
  }

  const supabase = serviceClient();
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData?.user) {
    const error = new Error('Session หมดอายุหรือไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่');
    error.statusCode = 401;
    error.code = 'invalid_session';
    throw error;
  }

  const user = authData.user;
  const { data: member, error: memberError } = await supabase
    .from('team_members')
    .select('id,user_id,email,role,person_code,active')
    .eq('user_id', user.id)
    .eq('active', true)
    .maybeSingle();

  if (memberError) throw memberError;
  if (!member) {
    const error = new Error('บัญชีนี้ยังไม่ได้ถูกเพิ่มเป็นสมาชิกทีม Auto Sync');
    error.statusCode = 403;
    error.code = 'not_team_member';
    throw error;
  }

  return { supabase, user, member };
}

module.exports = { serviceClient, requireTeamMember };
