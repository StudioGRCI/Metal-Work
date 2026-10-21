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
  const word = t.some((x) => x === '.docx' || x === '.doc' || x.includes('wordprocessingml') || x === 'application/msword')
  const foto = t.some((x) => x.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.webp'].includes(x))
  if (excel) return { que: 'Elegir el Excel', formato: 'Solo Excel (.xlsx)', noEs: 'No es un Excel (.xlsx)', Icono: FileSpreadsheet }
  if (xml) return { que: 'Elegir el XML', formato: 'XML o ZIP de SUNAT', noEs: 'No es un XML ni un ZIP', Icono: FileCode }
  if (pdf && word) return { que: 'Elegir el PDF o el Word', formato: 'PDF o Word', noEs: 'No es un PDF ni un Word', Icono: FileText }
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

/**
 * Por qué el archivo no sirve —no es del tipo, está vacío, pasa del tope—, en
 * las mismas palabras que pone el campo; `null` si sirve. Para las pantallas
 * que leen o suben el archivo apenas se elige: así no lo intentan con uno que
 * el campo ya marcó en rojo.
 */
export function avisoDeArchivo(archivo: File, accept: string, hastaMb?: number): string | null {
  if (!coincide(archivo, accept)) return `${tipoDe(accept, false).noEs}: toca para elegir otro`
  if (archivo.size === 0) return 'Está vacío: toca para elegir otro'
  if (hastaMb && archivo.size > hastaMb * 1024 * 1024) {
    return `Pesa ${tamanoArchivo(archivo.size)} y el tope es ${hastaMb} MB: toca para elegir otro`
  }
  return null
}

/**
 * Lo mismo para un PDF, y además que lo sea por dentro: un Word o una foto con
 * el nombre cambiado a «.pdf» pasa por la extensión y después no lo abre nadie.
 */
export async function avisoDePdf(archivo: File, hastaMb?: number): Promise<string | null> {
  const aviso = avisoDeArchivo(archivo, 'application/pdf,.pdf', hastaMb)
  if (aviso) return aviso
  const cabecera = new TextDecoder().decode(await archivo.slice(0, 5).arrayBuffer())
  return cabecera === '%PDF-' ? null : 'Está dañado o no es un PDF de verdad: toca para elegir otro'
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
  /**
   * El archivo que guarda la pantalla, cuando lo lee o lo sube apenas se elige
   * y vacía el campo para que se pueda volver a elegir el mismo. Sin esto, el
   * campo muestra lo que tiene elegido.
   */
  archivo?: File | null
  /** Por qué no sirve, cuando lo sabe la pantalla: «No se pudo leer», el rechazo de la subida. Gana al aviso propio. */
  aviso?: string | null
  /** Lo que está pasando con el archivo: «Leyendo el Excel…», «Subiendo…». */
  estado?: string | null
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
 * bloquea: el que decide es el servidor. Es el mismo en todo lugar que pide
 * un archivo, también donde se lee o se sube apenas se elige (`archivo`,
 * `aviso` y `estado`): «aplica para todo lugar que pida documento» (DKS,
 * 2026-10-21).
 */
export const ElegirArchivo = React.forwardRef<HTMLInputElement, ElegirArchivoProps>(function ElegirArchivo(
  {
    texto,
    hastaMb,
    archivo: archivoDeLaPantalla,
    aviso: avisoDeLaPantalla,
    estado,
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
  const [delCampo, setDelCampo] = React.useState<File | null>(null)
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
      setDelCampo(input.files?.[0] ?? null)
      const form = input.form
      const alVaciar = () => {
        input.setCustomValidity('')
        setDelCampo(null)
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

  const archivo = archivoDeLaPantalla !== undefined ? archivoDeLaPantalla : delCampo
  const aviso = avisoDeLaPantalla || (archivo ? avisoDeArchivo(archivo, accept, hastaMb) : null)
  const limite = hastaMb ? `hasta ${hastaMb} MB` : ''
  const pie =
    aviso ??
    estado ??
    (archivo ? `${tamanoArchivo(archivo.size)} · toca para cambiarlo` : [tipo.formato, limite].filter(Boolean).join(', '))
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
          : mal
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
          setDelCampo(e.currentTarget.files?.[0] ?? null)
          onChange?.(e)
        }}
        {...props}
      />
    </div>
  )
})
