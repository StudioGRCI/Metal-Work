# Verificación local del sistema

**Fecha:** 27/09/2026

**Entorno:** copia de pruebas con PostgreSQL local y datos ficticios.

## Comprobaciones

- La suite completa aplicó las migraciones y ejecutó los checks SQL en la base local `metalwork_test`.
- Next.js generó los tipos y TypeScript terminó sin errores.
- ESLint terminó sin errores; dejó cuatro avisos de variables no usadas en archivos preexistentes.
- El recorrido automatizado de pantallas registró 38 comprobaciones aprobadas, incluidas las vistas de supervisión de Producción, Maestranza y Acabados.
- `git diff --check` no encontró errores de formato en los cambios preparados.

## Límites

- Estas pruebas usan datos y cuentas ficticias; no representan escrituras con usuarios reales.
- No se aplicaron migraciones ni cambios de permisos en Supabase.
- La opción de reporte aparece para el supervisor autorizado y la base valida los permisos por área. El recorrido no envió un reporte desde el navegador.
- El selector compacto se verificará también en la vista previa de Vercel antes de integrar el cambio.
