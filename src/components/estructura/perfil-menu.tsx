import { LogOut } from 'lucide-react'
import { iniciales } from '@/lib/format'

export function PerfilMenu({ puesto, rol }: { puesto: string; rol: string }) {
  return <section aria-label="Tu cuenta" className="shrink-0 border-t border-borde bg-superficie p-4">
    <div className="mb-3 flex items-center gap-3">
      <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-acento-suave text-sm font-semibold text-acento">{iniciales(puesto)}</span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-texto">{puesto}</p>
        {rol !== puesto && <p className="text-xs text-texto-suave">{rol}</p>}
      </div>
    </div>
    <form action="/auth/salir" method="post">
      <button type="submit" className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-borde text-sm font-medium text-texto-suave transition-colors hover:border-peligro hover:bg-peligro-suave hover:text-peligro focus-visible:outline-2 focus-visible:outline-acento">
        <LogOut aria-hidden className="size-4" /> Cerrar sesión
      </button>
    </form>
  </section>
}
