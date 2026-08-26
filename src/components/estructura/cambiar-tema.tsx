'use client'

import { Monitor, Moon, Sun } from 'lucide-react'
import { useSyncExternalStore } from 'react'

import { cn } from '@/lib/utils'

/**
 * Elección de tema: claro, oscuro o el del sistema.
 *
 * La elección se guarda en el navegador de cada persona, así que el jefe de
 * taller puede tener la pantalla oscura en el taller y administración clara en
 * la oficina, sin pisarse.
 */

export const LLAVE_TEMA = 'metalwork:tema'

type Tema = 'claro' | 'oscuro' | 'sistema'

const OPCIONES: { valor: Tema; etiqueta: string; Icono: typeof Sun }[] = [
  { valor: 'claro', etiqueta: 'Claro', Icono: Sun },
  { valor: 'oscuro', etiqueta: 'Oscuro', Icono: Moon },
  { valor: 'sistema', etiqueta: 'El del sistema', Icono: Monitor },
]

// El valor vive en el navegador, no en React: se lee de ahí y se avisa a quien
// esté mirando. Así no hace falta corregir el estado después de montar, que es
// lo que produce el parpadeo.
const avisos = new Set<() => void>()

function suscribir(avisar: () => void) {
  avisos.add(avisar)
  window.addEventListener('storage', avisar)
  return () => {
    avisos.delete(avisar)
    window.removeEventListener('storage', avisar)
  }
}

function temaGuardado(): Tema {
  try {
    const valor = localStorage.getItem(LLAVE_TEMA)
    return valor === 'claro' || valor === 'oscuro' ? valor : 'sistema'
  } catch {
    return 'sistema'
  }
}

// En el servidor no se sabe qué eligió esta persona.
const temaEnElServidor = (): Tema => 'sistema'

export function CambiarTema() {
  const tema = useSyncExternalStore(suscribir, temaGuardado, temaEnElServidor)

  function elegir(nuevo: Tema) {
    const raiz = document.documentElement
    if (nuevo === 'sistema') raiz.removeAttribute('data-tema')
    else raiz.setAttribute('data-tema', nuevo)

    try {
      if (nuevo === 'sistema') localStorage.removeItem(LLAVE_TEMA)
      else localStorage.setItem(LLAVE_TEMA, nuevo)
    } catch {
      // Navegador con el almacenamiento bloqueado: vale para esta sesión.
    }
    avisos.forEach((avisar) => avisar())
  }

  return (
    <div
      role="group"
      aria-label="Tema de la pantalla"
      className="flex items-center rounded-[var(--radius-base)] bg-superficie-2 p-0.5"
    >
      {OPCIONES.map(({ valor, etiqueta, Icono }) => (
        <button
          key={valor}
          type="button"
          onClick={() => elegir(valor)}
          title={etiqueta}
          aria-label={etiqueta}
          aria-pressed={tema === valor}
          className={cn(
            'flex size-7 items-center justify-center rounded-[calc(var(--radius-base)-2px)] text-texto-tenue transition-colors',
            'hover:text-texto',
            tema === valor && 'bg-superficie text-texto shadow-[var(--sombra)]',
          )}
        >
          <Icono className="size-3.5" />
        </button>
      ))}
    </div>
  )
}
