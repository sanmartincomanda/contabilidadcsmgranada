# Finanzas App - Carnes San Martin Granada

App React con Vite y Firebase para registrar ingresos, gastos, compras, inventario y reportes.

## Requisitos

- Node 18+
- npm

## Instalacion

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## Ingresos

La app ahora soporta dos origenes de ingreso:

- `manual`
- `sicar`

Los ingresos sincronizados desde SICAR se guardan en Firestore dentro de `ingresos`, y los reportes priorizan el ingreso `sicar` del mismo dia para evitar doble conteo si tambien existe un ingreso manual.

## API Firebase para SICAR

La integracion backend quedo preparada en:

- `functions/index.js`
- `functions/README.md`

Incluye:

- callable function para sincronizar desde la app
- endpoint HTTP protegido por token
- escritura diaria con `upsert` en Firestore
- bitacora en `sicar_sync_logs`
