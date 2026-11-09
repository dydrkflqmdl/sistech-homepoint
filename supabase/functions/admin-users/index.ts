// admin-users Edge Function 진입점(Deno). 로직은 handler.js 에 있고 여기서는 supabase-js 서비스 롤 클라이언트를
// 작은 deps 인터페이스(handler.js 의 AdminDeps JSDoc)로 감싸 넘기기만 한다.
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 는 Supabase 가 실행 환경에 자동으로 넣어 준다(우리는 어디에도 저장하지 않음).
// ALLOWED_ORIGINS(선택): 쉼표로 구분한 허용 출처. 예) https://sistech.dpdns.org,http://localhost:4100
//   비워 두면 지금처럼 모든 출처('*')를 허용한다. 설정: supabase secrets set ALLOWED_ORIGINS=...
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

// handler.js 의 AdminDeps 와 같은 모양. 바꿀 때는 두 파일을 함께 고친다.
interface CreateUserAttrs {
  email: string;
  password: string;
  email_confirm: boolean;
  user_metadata: { login_id: string };
  app_metadata: { login_id: string };
}

interface AdminDeps {
  getUser(token: string): Promise<User | null>;
  listUsers(): Promise<User[]>;
  createUser(attrs: CreateUserAttrs): Promise<User>;
  updateUserById(id: string, attrs: { password: string }): Promise<User>;
}

const deps: AdminDeps = {
  // 토큰을 Auth 서버에서 검증한다. 무효하면 null.
  async getUser(token) {
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

  // app_metadata 는 service_role 만 쓸 수 있다. login_id 를 여기에도 넣어 목록 표시의 기준으로 쓴다(계약 C4).
  async createUser(attrs) {
    const { data, error } = await admin.auth.admin.createUser(attrs);
    if (error) throw error; // AuthApiError: code 'email_exists' 등은 handler 가 상태 코드로 옮긴다
    return data.user;
  },

  async updateUserById(id, attrs) {
    const { data, error } = await admin.auth.admin.updateUserById(id, attrs);
    if (error) throw error; // code 'user_not_found' → 404
    return data.user;
  },
};

Deno.serve(createHandler(deps, { allowedOrigins: Deno.env.get('ALLOWED_ORIGINS') ?? '' }));
