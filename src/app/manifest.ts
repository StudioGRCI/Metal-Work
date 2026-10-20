import type { MetadataRoute } from 'next'

/**
 * Lo que el teléfono necesita para instalar el sistema como aplicación: nombre,
 * íconos y que se abra sin la barra del navegador (`standalone`).
 *
 * Arranca en el dashboard, que lo ve todo el mundo. El atajo lleva a los
 * avisos, que también son de todos: el que había («Nuevo trabajo sin orden»)
 * abría una pantalla que hoy solo abren Gerencia y Supervisión, y a los demás les decía
 * «Sin permiso» (revisión del 2026-10-20).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Metal Work',
    short_name: 'Metal Work',
    description: 'Cotizaciones, órdenes de trabajo y el avance del taller de Metal Work, con foto.',
    lang: 'es-PE',
    dir: 'ltr',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    categories: ['business', 'productivity'],
    icons: [
      { src: '/iconos/icono-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/iconos/icono-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/iconos/icono-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      {
        name: 'Mis avisos',
        url: '/avisos',
        icons: [{ src: '/iconos/icono-192.png', sizes: '192x192' }],
      },
    ],
  }
}
