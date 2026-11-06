// admin-users Edge Function 진입점(Deno). 로직은 handler.js 에 있고 여기서는 supabase-js 서비스 롤 클라이언트를
// 작은 deps 인터페이스로 감싸 넘기기만 한다.
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 는 Supabase 가 실행 환경에 자동으로 넣어 준다(우리는 어디에도 저장하지 않음).
import { createClient, type User } from 'jsr:@supabase/supabase-js@2';
import { createHandler } from './handler.js';

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 환경 변수가 없습니다.');
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});

const PER_PAGE = 1000; // Supabase listUsers 한 페이지 최대치

const deps = {
  // 토큰을 Auth 서버에서 검증한다. 무효하면 null.
  async getUser(token: string) {
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user;
  },

  // 전체 사용자. 페이지를 끝까지 돌며 모은다.
  async listUsers() {
    const users: User[] = [];
    for (let page = 1; ; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE });
      if (error) throw error;
      users.push(...data.users);
      if (data.users.length < PER_PAGE) break;
    }
    return users;
  },

  async createUser(attrs: Parameters<typeof admin.auth.admin.createUser>[0]) {
    const { data, error } = await admin.auth.admin.createUser(attrs);
    if (error) throw error; // AuthApiError: code 'email_exists' 등은 handler 가 상태 코드로 옮긴다
    return data.user;
  },

  async updateUserById(id: string, attrs: Parameters<typeof admin.auth.admin.updateUserById>[1]) {
    const { data, error } = await admin.auth.admin.updateUserById(id, attrs);
    if (error) throw error; // code 'user_not_found' → 404
    return data.user;
  },
};

Deno.serve(createHandler(deps));
