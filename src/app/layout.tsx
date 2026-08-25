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

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="es-PE" className="h-full">
      <body className="min-h-full">{children}</body>
    </html>
  )
}
