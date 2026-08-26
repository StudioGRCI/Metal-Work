import type { Metadata, Viewport } from 'next'

import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'Metal-Work · Gestión de órdenes de trabajo',
    template: '%s · Metal-Work',
  },
  description:
    'Control de órdenes de trabajo, trazabilidad documental, almacén y costos para fabricación de carrocerías.',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f7f9' },
    { media: '(prefers-color-scheme: dark)', color: '#0d1117' },
  ],
}

/**
 * Se aplica el tema elegido antes de que el navegador pinte la primera pantalla.
 * Si esto corriera después, se vería el destello de la pantalla clara antes de
 * pasar a oscura, que es justo lo que molesta de noche en el taller.
 */
const APLICAR_TEMA = `try{var t=localStorage.getItem('metalwork:tema');if(t==='claro'||t==='oscuro'){document.documentElement.setAttribute('data-tema',t)}}catch(e){}`

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    // El guion de arriba escribe `data-tema` en esta misma etiqueta antes de que
    // React hidrate, así que el atributo no coincide con lo que vino del
    // servidor. Es a propósito: se avisa para que React no lo reporte.
    <html lang="es-PE" className="h-full" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: APLICAR_TEMA }} />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  )
}
