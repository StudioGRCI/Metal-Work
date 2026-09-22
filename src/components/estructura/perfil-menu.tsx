import { LogOut } from 'lucide-react'
import { iniciales } from '@/lib/format'

export function PerfilMenu({ puesto, rol }: { puesto: string; rol: string }) {
  return <section aria-label="Tu cuenta" className="flex shrink-0 items-center gap-2 border-t border-borde bg-superficie p-3">
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-acento-suave text-sm font-semibold text-acento">{iniciales(puesto)}</span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-texto">{puesto}</p>
        {rol !== puesto && <p className="text-xs text-texto-suave">{rol}</p>}
      </div>
    </div>
    <form action="/auth/salir" method="post" className="shrink-0">
      <button type="submit" aria-label="Cerrar sesión" title="Cerrar sesión" className="flex size-11 items-center justify-center rounded-xl border border-borde text-texto-suave transition-colors hover:border-peligro hover:bg-peligro-suave hover:text-peligro focus-visible:outline-2 focus-visible:outline-acento">
        <LogOut aria-hidden className="size-4" />
      </button>
    </form>
  </section>
}
