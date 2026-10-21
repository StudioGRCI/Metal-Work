'use client'

import * as React from 'react'
import { Camera, FileCode, FileSpreadsheet, FileText, FileUp, ImageIcon, type LucideIcon } from 'lucide-react'

import { tamanoArchivo } from '@/lib/format'
import { cn } from '@/lib/utils'

type Tipo = {
  que: string
  /** Lo que dice con ratón, si no es lo mismo que con el dedo. */
  queConRaton?: string
  formato: string
  noEs: string
  Icono: LucideIcon
}

/**
 * Qué pide el campo, sacado de su `accept`: así cada pantalla dice lo mismo
 * para lo mismo sin repetir el texto a mano en cada formulario.
 */
function tipoDe(accept: string, conCamara: boolean): Tipo {
  const t = accept.toLowerCase().split(',').map((x) => x.trim()).filter(Boolean)
  const excel = t.some((x) => x === '.xlsx' || x.includes('spreadsheetml'))
  const xml = t.some((x) => x === '.xml' || x.endsWith('/xml'))
  const pdf = t.some((x) => x === '.pdf' || x === 'application/pdf')
  const foto = t.some((x) => x.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.webp'].includes(x))
  if (excel) return { que: 'Elegir el Excel', formato: 'Solo Excel (.xlsx)', noEs: 'No es un Excel (.xlsx)', Icono: FileSpreadsheet }
  if (xml) return { que: 'Elegir el XML', formato: 'XML o ZIP de SUNAT', noEs: 'No es un XML ni un ZIP', Icono: FileCode }
  if (pdf && foto) return { que: 'Elegir el PDF o la foto', formato: 'PDF, JPG, PNG o WEBP', noEs: 'No es un PDF ni una foto', Icono: FileUp }
  if (pdf) return { que: 'Elegir el PDF', formato: 'Solo PDF', noEs: 'No es un PDF', Icono: FileText }
  if (foto) {
    // Con `capture`, el teléfono y la tableta abren la cámara de frente, sin la
    // galería; con ratón no hay cámara y sale el explorador de archivos.
    return conCamara
      ? { que: 'Tomar la foto', queConRaton: 'Elegir la foto', formato: 'JPG, PNG o WEBP', noEs: 'No es una foto JPG, PNG o WEBP', Icono: Camera }
      : { que: 'Elegir la foto', formato: 'JPG, PNG o WEBP', noEs: 'No es una foto JPG, PNG o WEBP', Icono: ImageIcon }
  }
  return { que: 'Elegir el archivo', formato: '', noEs: 'No es del tipo que se pide', Icono: FileUp }
}

/** Si el archivo elegido es de lo que pide el `accept`, por extensión o por tipo. */
function coincide(archivo: File, accept: string): boolean {
  const t = accept.toLowerCase().split(',').map((x) => x.trim()).filter(Boolean)
  if (t.length === 0) return true
  const nombre = archivo.name.toLowerCase()
  const tipo = archivo.type.toLowerCase()
  return t.some((x) =>
    x.startsWith('.') ? nombre.endsWith(x) : x.endsWith('/*') ? tipo.startsWith(x.slice(0, -1)) : tipo === x,
  )
}

/** «Elegir el Excel de la planilla» → «Falta el Excel de la planilla.» */
function faltaDe(principal: string): string {
  const objeto = principal.replace(/^(Tomar|Elegir)\s+/, '')
  return objeto === principal ? 'Elige el archivo.' : `Falta ${objeto}.`
}

export type ElegirArchivoProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'multiple'> & {
  /** La línea principal antes de elegir. Sin esto sale del `accept`: «Elegir el PDF». */
  texto?: string
  /** El tope que valida el servidor: se dice antes de elegir y se avisa si el archivo pasa. */
  hastaMb?: number
}

/**
 * El campo para elegir un archivo, en castellano y diciendo qué pide.
 *
 * El `<input type="file">` del navegador pinta su propio botón —«Choose File»,
 * «Seleccionar archivo» o «Examinar», según el idioma del equipo y no el de la
 * página—, corta el nombre del archivo a la mitad y no dice qué espera: en
 * «Importar del Excel» se veía «Choose File PRUEBA-NO-E…TAL-WORK.txt» y nada
 * avisaba que eso no era un Excel hasta apretar «Leer y comprobar» (DKS,
 * 2026-10-21). Ese botón no se puede traducir desde la página, así que no se
 * pinta: el campo de verdad sigue ahí, transparente y tapando toda la caja,
 * para que el formulario lo envíe igual, el `required` funcione, el teclado
 * llegue y se pueda soltar un archivo arrastrado desde el escritorio. Por lo
 * mismo, el globo de «obligatorio» también se escribe aquí: el del navegador
 * decía «Please select a file.».
 *
 * Lo que dice cambia con lo elegido: el nombre entero y su peso, o el motivo
 * —no es del tipo, pasa del tope, está vacío— antes de enviar. Avisa, no
 * bloquea: el que decide es el servidor.
 */
export const ElegirArchivo = React.forwardRef<HTMLInputElement, ElegirArchivoProps>(function ElegirArchivo(
  {
    texto,
    hastaMb,
    accept = '',
    capture,
    className,
    disabled,
    required,
    onChange,
    onInvalid,
    'aria-describedby': descrito,
    'aria-invalid': invalidoDesdeAfuera,
    ...props
  },
  ref,
) {
  const [archivo, setArchivo] = React.useState<File | null>(null)
  const propio = React.useRef<HTMLInputElement | null>(null)
  const idEstado = React.useId()
  const tipo = tipoDe(accept, Boolean(capture))

  // Se conecta al montar y no en un efecto: así toma también el archivo que se
  // eligió antes de que la página terminara de cargar, y se entera cuando el
  // formulario se vacía con `reset()` sin pasar por `onChange`.
  const conectar = React.useCallback(
    (input: HTMLInputElement | null) => {
      propio.current = input
      if (typeof ref === 'function') ref(input)
      else if (ref) ref.current = input
      if (!input) return
      setArchivo(input.files?.[0] ?? null)
      const form = input.form
      const alVaciar = () => {
        input.setCustomValidity('')
        setArchivo(null)
      }
      form?.addEventListener('reset', alVaciar)
      return () => {
        form?.removeEventListener('reset', alVaciar)
        propio.current = null
        if (typeof ref === 'function') ref(null)
        else if (ref) ref.current = null
      }
    },
    [ref],
  )

  // Si deja de ser obligatorio (la captura de la caja depende del tipo de
  // cuenta), el «Falta…» de un intento anterior no puede seguir trabando el envío.
  React.useEffect(() => {
    if (!required) propio.current?.setCustomValidity('')
  }, [required])

  const vacio = archivo ? archivo.size === 0 : false
  const pasa = archivo && hastaMb ? archivo.size > hastaMb * 1024 * 1024 : false
  const ajeno = archivo ? !coincide(archivo, accept) : false
  const aviso = ajeno
    ? `${tipo.noEs}: toca para elegir otro`
    : vacio
      ? 'Está vacío: toca para elegir otro'
      : pasa
        ? `Pesa ${tamanoArchivo(archivo!.size)} y el tope es ${hastaMb} MB: toca para elegir otro`
        : null
  const limite = hastaMb ? `hasta ${hastaMb} MB` : ''
  const pie = archivo
    ? (aviso ?? `${tamanoArchivo(archivo.size)} · toca para cambiarlo`)
    : [tipo.formato, limite].filter(Boolean).join(', ')
  const invalido = invalidoDesdeAfuera === true || invalidoDesdeAfuera === 'true'
  const mal = Boolean(aviso) || invalido
  const principal = texto ?? tipo.que

  return (
    <div
      className={cn(
        'relative flex min-h-11 items-center gap-3 rounded-[var(--radius-base)] border px-3 py-2',
        archivo
          ? mal
            ? 'border-solid border-peligro bg-peligro-suave/40'
            : 'border-solid border-exito'
          : invalido
            ? 'border-dashed border-peligro'
            : 'border-dashed border-borde-fuerte',
        // El campo de verdad es transparente: su anillo de foco (globals.css)
        // no se vería, así que lo lleva la caja, con el mismo grosor y color.
        'has-[:focus-visible]:border-acento has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-anillo-foco',
        // Con aviso, el fondo rojo se queda aunque pase el ratón.
        disabled ? 'opacity-60' : !mal && 'hover:bg-superficie-2',
        className,
      )}
    >
      <tipo.Icono
        aria-hidden
        className={cn('size-5 shrink-0', mal ? 'text-peligro' : archivo ? 'text-exito' : 'text-texto-tenue')}
      />
      <span id={idEstado} className="min-w-0 flex-1">
        <span className={cn('block text-sm font-medium break-all', archivo ? 'text-texto' : 'text-acento')}>
          {archivo ? (
            archivo.name
          ) : texto || !tipo.queConRaton ? (
            principal
          ) : (
            // Por el puntero y no por el ancho: una tableta o un teléfono
            // acostado son anchos y también abren la cámara.
            <>
              <span className="pointer-fine:hidden">{tipo.que}</span>
              <span className="hidden pointer-fine:inline">{tipo.queConRaton}</span>
            </>
          )}
        </span>
        {/* Se anuncia al elegir: el aviso de «no es un Excel» llega también a quien no ve la caja. */}
        {pie && (
          <span aria-live="polite" className={cn('block text-xs', aviso ? 'text-peligro' : 'text-texto-tenue')}>
            {pie}
          </span>
        )}
      </span>
      <input
        ref={conectar}
        type="file"
        accept={accept || undefined}
        capture={capture}
        disabled={disabled}
        required={required}
        aria-describedby={descrito ? `${descrito} ${idEstado}` : idEstado}
        aria-invalid={mal || undefined}
        className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed file:cursor-pointer"
        onInvalid={(e) => {
          if (e.currentTarget.validity.valueMissing) e.currentTarget.setCustomValidity(faltaDe(principal))
          onInvalid?.(e)
        }}
        onChange={(e) => {
          e.currentTarget.setCustomValidity('')
          setArchivo(e.currentTarget.files?.[0] ?? null)
          onChange?.(e)
        }}
        {...props}
      />
    </div>
  )
})
