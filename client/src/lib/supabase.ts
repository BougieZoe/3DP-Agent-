import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://wzazrdpduiypflckkibh.supabase.co';
const supabaseAnonKey = 'sb_publishable_c9H3AGZwRUFA0PTyqL1TLg_HcPdRWAb';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export interface User {
  id: string;
  email: string;
}
