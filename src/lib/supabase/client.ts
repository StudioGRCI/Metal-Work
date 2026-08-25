import { createBrowserClient } from '@supabase/ssr'

import type { Database } from '@/types/database'

/** Cliente de Supabase para componentes que corren en el navegador. */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
