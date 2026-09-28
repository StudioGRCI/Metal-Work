'use client'

import { Check, Monitor, Moon, Sun } from 'lucide-react'
import { useLayoutEffect, useState, useSyncExternalStore } from 'react'

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
  { valor: 'sistema', etiqueta: 'Sistema', Icono: Monitor },
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
  const [abierto, setAbierto] = useState(false)
  const opcionActiva = OPCIONES.find((opcion) => opcion.valor === tema) ?? OPCIONES[2]

  // En desarrollo React vuelve a montar una vez para sacar errores a la luz, y
  // en ese remontaje limpia los atributos de <html> que no vienen del JSX,
  // incluido el que puso el guion del encabezado. Se vuelve a poner antes de
  // pintar. En producción no hace nada.
  useLayoutEffect(() => {
    const guardado = temaGuardado()
    const raiz = document.documentElement
    if (guardado === 'sistema') raiz.removeAttribute('data-tema')
    else raiz.setAttribute('data-tema', guardado)
  }, [tema])

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
    setAbierto(false)
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setAbierto((valor) => !valor)}
        aria-label={`Tema: ${opcionActiva.etiqueta}. Cambiar tema`}
        aria-expanded={abierto}
        aria-haspopup="menu"
        className="flex size-10 items-center justify-center rounded-full border border-borde bg-superficie text-texto-suave transition-colors hover:bg-superficie-2 hover:text-texto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento"
      >
        <opcionActiva.Icono aria-hidden className="size-5" />
      </button>
      {abierto && (
        <div role="menu" aria-label="Tema de la pantalla" className="absolute left-0 top-full z-50 mt-2 w-48 rounded-[var(--radius-base)] border border-borde bg-superficie p-1.5 shadow-[var(--sombra)]">
          {OPCIONES.map(({ valor, etiqueta, Icono }) => (
            <button
              key={valor}
              type="button"
              role="menuitemradio"
              aria-checked={tema === valor}
              onClick={() => elegir(valor)}
              className={cn(
                'flex min-h-10 w-full items-center gap-2 rounded-[var(--radius-base)] px-2.5 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-acento',
                tema === valor ? 'bg-acento-suave font-medium text-texto' : 'text-texto-suave hover:bg-superficie-2 hover:text-texto',
              )}
            >
              <Icono aria-hidden className="size-4" />
              <span className="flex-1">{etiqueta}</span>
              {tema === valor && <Check aria-hidden className="size-4 text-acento" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
