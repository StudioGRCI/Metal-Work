import { FileText } from 'lucide-react'

/** El enlace temporal a un recibo o un voucher. Sin enlace (el almacenamiento no respondió), lo dice. */
export function EnlaceArchivo({ enlace, texto }: { enlace: string | null; texto: string }) {
  if (!enlace) return <span className="text-xs text-texto-suave">{texto} (no se pudo abrir ahora)</span>
  return (
    <a
      href={enlace}
      target="_blank"
      rel="noreferrer"
      className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-borde px-2 text-xs font-medium text-acento hover:bg-superficie-2"
    >
      <FileText aria-hidden className="size-3.5" />
      {texto}
    </a>
  )
}
