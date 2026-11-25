import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Worktrees de los auditores (skill `auditar`): no son código del proyecto.
    ".claude/worktrees/**",
  ]),
  // La letra más chica del sistema es de 12 px (`text-xs`): decisión de DKS del
  // 2026-11-25, skill `diseno` › Texto. Las excepciones —la burbuja del
  // contador, el glifo «i» y los formatos que se imprimen— llevan su permiso
  // escrito al lado.
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/text-\\[(?:[0-9]|1[01])(?:\\.[0-9]+)?px\\]/]",
          message: "La letra más chica es de 12 px: usa text-xs (skill diseno › Texto).",
        },
        {
          selector: "TemplateElement[value.raw=/text-\\[(?:[0-9]|1[01])(?:\\.[0-9]+)?px\\]/]",
          message: "La letra más chica es de 12 px: usa text-xs (skill diseno › Texto).",
        },
      ],
    },
  },
  // Los formatos que se imprimen: ahí el tamaño es parte del formato de la casa.
  {
    files: [
      "src/app/(app)/cotizaciones/pdf/**",
      "src/app/(app)/almacen/movimientos/*/formato/**",
      "src/app/(app)/ordenes/*/expediente/**",
    ],
    rules: { "no-restricted-syntax": "off" },
  },
]);

export default eslintConfig;
