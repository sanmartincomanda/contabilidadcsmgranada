# Base Nueva Sucursal

Este paquete es una copia base de la app contable para instalar en otra computadora o servidor y comenzar una nueva variante del sistema para otra sucursal.

## Que ya viene en el ZIP

- frontend React + Vite
- backend Firebase Functions
- scripts de integracion SICAR
- estructura completa del proyecto
- base tecnica de compras, cuentas por pagar, gastos diarios, ingresos y reportes

## Que NO viene en el ZIP

- `.git`
- `node_modules`
- `dist`
- llaves privadas de Firebase
- configuracion local de Claude/Codex

## Objetivo de esta copia

Esta copia sirve para:

- mover el sistema a otra computadora o servidor
- crear una Firebase completamente nueva
- conectar esa nueva app con el MySQL del nuevo servidor SICAR
- usar esta base como plantilla y luego hacer cambios especificos para la nueva sucursal

## Antes de correr la app

### 1. Instalar dependencias

En la raiz del proyecto:

```powershell
npm install
```

En `functions/`:

```powershell
cd functions
npm install
cd ..
```

### 2. Crear la nueva Firebase

Esta copia ya quedo enlazada al proyecto Firebase nuevo `sistema-contable-csm-granada`.

Los archivos que ya quedaron configurados son:

- [src/firebase.js](./src/firebase.js)
- [.firebaserc](./.firebaserc)

Si en otra instalacion se vuelve a clonar esta base para una sucursal distinta, ahi si hay que volver a reemplazar esos datos por el nuevo proyecto correspondiente.

Servicios recomendados en la nueva Firebase:

- Authentication
- Cloud Firestore
- Cloud Functions

### 3. Llave de administrador en el nuevo servidor

No guardes la llave JSON dentro del repo.

Opciones:

- definir `GOOGLE_APPLICATION_CREDENTIALS`
- o colocar la llave en:

```text
C:\SICAR\keys\firebase-adminsdk.json
```

En esta preparacion, la llave que se identifico fuera del repo es:

```text
C:\Users\Microsoft Windows 11\Downloads\sistema-contable-csm-granada-firebase-adminsdk-fbsvc-06ceb5dfe2.json
```

### 4. Firebase CLI en el nuevo servidor

Si se van a desplegar Functions desde el nuevo servidor:

```powershell
npm install -g firebase-tools
firebase login
firebase use sistema-contable-csm-granada
```

## Arquitectura recomendada para la nueva integracion SICAR

### Regla principal

El servidor SICAR o el worker local del servidor nunca debe escribir directo a las colecciones visibles sin pasar por staging privado.

### Base privada recomendada

```text
integraciones_privadas/sicar/compras_raw/{rawId}
integraciones_privadas/sicar/ventas_raw/{rawId}
```

Si luego se quiere optimizar ventas por total diario, se puede evolucionar a una variante como:

```text
integraciones_privadas/sicar/ventas_raw_por_dia/{yyyy-mm-dd}
```

pero esta copia base ya viene preparada con `compras_raw` y `ventas_raw`.

### Flujo de compras

1. SICAR/MySQL entrega compras
2. se normalizan
3. se guardan primero en `integraciones_privadas/sicar/compras_raw`
4. luego se procesan a la app visible

Mapeo esperado:

- `efectivo`
  - crea `gastosDiarios`
  - crea `compras`
- `credito`
  - crea `cuentas_por_pagar`
  - crea `compras`
- otro metodo
  - crea solo `compras`

### Flujo de ventas

1. SICAR/MySQL entrega ventas
2. se normalizan
3. se guardan primero en `integraciones_privadas/sicar/ventas_raw`
4. luego se procesan a `ingresos`

Recomendacion para la nueva sucursal:

- si se quiere bajar lecturas y costos, trabajar ventas por total diario y no por cada ticket individual

### Anulaciones

Si SICAR marca un movimiento como anulado o cancelado, el integrador debe reflejarlo en Firebase.

Compras:

- si era `credito`
  - revertir `cuentas_por_pagar`
  - revertir `compras`
- si era `efectivo`
  - revertir `gastosDiarios`
  - revertir `compras`
- si era otro medio
  - revertir solo `compras`

Ventas:

- revertir o actualizar el ingreso correspondiente

### Folio / factura

Si SICAR manda folio:

- usarlo como numero de factura

Si viene vacio:

- dejarlo vacio
- no inventar `S/N`

## Datos que el nuevo Codex debe identificar en MySQL de SICAR

El nuevo Codex debe revisar la base del nuevo servidor y confirmar:

- host
- puerto
- nombre de base
- usuario
- metodo real de acceso
- tablas o vistas de compras
- tablas o vistas de ventas
- columnas equivalentes a:
  - fecha
  - monto / total
  - proveedor
  - folio / numero_factura
  - metodo_pago
  - vencimiento
  - id unico del movimiento
  - estado / anulacion

## Secrets y configuracion esperada

En la nueva Firebase, el nuevo Codex debe dejar configurados estos secrets:

```powershell
firebase functions:secrets:set SICAR_DB_HOST
firebase functions:secrets:set SICAR_DB_USER
firebase functions:secrets:set SICAR_DB_PASSWORD
firebase functions:secrets:set SICAR_DB_NAME
firebase functions:secrets:set SICAR_INGRESOS_QUERY
firebase functions:secrets:set SICAR_COMPRAS_QUERY
firebase functions:secrets:set SICAR_SYNC_API_TOKEN
```

Y si hace falta, estos parametros:

- `SICAR_DB_PORT`
- `SICAR_BRANCH_ID`
- `SICAR_BRANCH_NAME`
- `SICAR_TIMEZONE`
- `SICAR_CASHBOX_NAME`
- `SICAR_PRIVATE_CUTOVER_DATE`

## Reglas de seguridad recomendadas

La nueva Firebase no debe dejar visible la base privada al navegador.

La regla deseada para `integraciones_privadas/**` es:

```text
allow read, write: if false;
```

o una variante equivalente que la deje solo para Admin SDK / Functions.

## Que debe hacer el nuevo Codex en el servidor

### Fase 1. Preparar el proyecto

1. descomprimir este ZIP en una carpeta de trabajo
2. instalar dependencias de raiz y de `functions/`
3. configurar la nueva Firebase en:
   - `src/firebase.js`
   - `.firebaserc`
4. configurar la llave de servicio
5. validar que la app arranca localmente

### Fase 2. Revisar SICAR / MySQL

1. localizar la conexion real del nuevo SICAR
2. revisar tablas de compras
3. revisar tablas de ventas
4. confirmar si la estructura es la misma que la del servidor anterior
5. documentar:
   - tablas elegidas
   - columnas usadas
   - forma de detectar anulaciones

### Fase 3. Integracion Firebase nueva

1. dejar lista la base privada `integraciones_privadas/sicar/*`
2. decidir si el modo sera:
   - Functions consultando MySQL
   - worker local del servidor empujando a Firestore
3. si usa worker local:
   - dejarlo idempotente
   - no duplicar documentos
   - usar `rawId` estable por movimiento
4. si usa Functions:
   - configurar queries y secrets
   - validar deploy

### Fase 4. Mapeo contable

1. compras por forma de pago:
   - efectivo -> `gastosDiarios` + `compras`
   - credito -> `cuentas_por_pagar` + `compras`
   - otro -> `compras`
2. ventas:
   - `ingresos`
3. anulaciones:
   - deben revertir reflejos previos
4. folio:
   - usar folio real
   - vacio se queda vacio

### Fase 5. Validacion

El nuevo Codex debe probar:

- una compra efectiva
- una compra a credito
- una compra con otro metodo
- una anulacion
- una venta / ingreso
- que no queden `pending` atorados
- que la nueva Firebase reciba datos, no la vieja

## Prompt sugerido para pegar al Codex del nuevo servidor

```text
Estoy en el nuevo servidor de la nueva sucursal.

Tengo esta copia base de la app contable y quiero usarla como nueva variante del sistema con una Firebase completamente nueva y conectada al MySQL de SICAR de este servidor.

Quiero que trabajes directamente sobre esta carpeta.

Objetivo:
- instalar esta app base
- configurar una Firebase nueva
- conectar la integracion con SICAR/MySQL de este servidor
- dejar la base privada en Firestore
- reflejar compras y ventas en la nueva app contable
- dejar documentado que cambiaste

Reglas:
- no uses la Firebase vieja
- no dejes llaves dentro del repo
- no escribas directo a colecciones visibles sin pasar por staging privado
- primero inspecciona la conexion real de SICAR
- no inventes tablas
- no hagas cambios destructivos en la base de SICAR

Arquitectura esperada:
- compras staging:
  integraciones_privadas/sicar/compras_raw/{rawId}
- ventas staging:
  integraciones_privadas/sicar/ventas_raw/{rawId}

Mapeo contable:
- compra efectivo -> gastosDiarios + compras
- compra credito -> cuentas_por_pagar + compras
- compra otro metodo -> compras
- ventas -> ingresos
- anulaciones deben revertir
- folio real debe pasar a factura
- folio vacio debe quedarse vacio

Quiero que trabajes por fases:

1. instalar dependencias
2. configurar nueva Firebase
3. revisar y documentar la conexion MySQL de SICAR
4. identificar tablas y columnas correctas
5. preparar o adaptar la integracion MySQL -> Firestore privado
6. procesar hacia colecciones visibles
7. validar con pruebas reales
8. dejar un resumen final exacto

Quiero que al final me entregues:
- nombre del nuevo proyecto Firebase usado
- archivos editados
- secrets requeridos
- tablas de SICAR identificadas
- query de ventas
- query de compras
- como se detectan anulaciones
- como se detecta folio
- si dejaste worker local o Functions
- como se ejecuta
- que pendientes quedan
```

## Nota final

Esta copia mantiene la logica actual de Carnes Amparito como base tecnica. La idea es usarla como plantilla y luego personalizarla para la nueva sucursal, la nueva Firebase y la nueva marca.
