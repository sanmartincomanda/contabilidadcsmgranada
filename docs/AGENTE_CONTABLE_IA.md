# Agente Contable IA

## Alcance

El modulo vive dentro de `Ingresar Datos > Agente IA`. WhatsApp es solamente el canal de entrada y conversacion; Firestore y los flujos oficiales de compras, gastos, CxP, Caja Chica y asientos siguen siendo la fuente operativa.

Ningun documento se registra por decision exclusiva del modelo. El motor prepara un borrador y el backend vuelve a validar proveedor, sucursal, categoria, cuenta, montos, pago, retenciones, soporte, confianza y duplicados antes de habilitar la confirmacion.

## Arquitectura

1. Meta llama al `whatsappWebhook` existente.
2. El webhook valida `x-hub-signature-256`, persiste un evento idempotente y responde HTTP 200.
3. `processAccountingAgentWhatsappEvent` valida el numero autorizado, descarga el original, valida MIME/tamano, calcula SHA-256 y lo guarda una sola vez.
4. OpenAI Responses API devuelve JSON bajo schema estricto.
5. El backend relaciona proveedor y Plan de Cuentas existentes, aplica reglas fijas y revisa duplicados.
6. El borrador queda en `READY_FOR_CONFIRMATION` o solicita un dato concreto por WhatsApp.
7. La confirmacion desde WhatsApp o la app ejecuta una transaccion atomica e idempotente.

## Colecciones

- `whatsapp_eventos`: cola privada e idempotente del webhook.
- `whatsapp_inbox`: metadata visible del mensaje y soporte.
- `agente_contable_borradores`: datos extraidos y estado de revision.
- `agente_contable_usuarios`: numeros autorizados.
- `agente_contable_reglas`: reglas fijas y aprobadas.
- `agente_contable_auditoria`: trazabilidad inmutable.
- `agente_contable_configuracion/estado`: salud operativa sin secretos.
- `agente_contable_duplicados`: llaves privadas de idempotencia final.

Los originales se guardan bajo `whatsapp/originales/{telefono}/{messageId}/{sha256}.{ext}`.

## Secrets y parametro

Configurar antes del deploy:

```powershell
firebase functions:secrets:set WHATSAPP_VERIFY_TOKEN
firebase functions:secrets:set WHATSAPP_ACCESS_TOKEN
firebase functions:secrets:set META_APP_SECRET
firebase functions:secrets:set OPENAI_API_KEY
```

Parametro opcional:

```text
OPENAI_ACCOUNTING_MODEL=gpt-5-mini
```

Los secretos nunca se muestran en la interfaz, Firestore ni logs.

## Despliegue

```powershell
npm install
cd functions
npm install
npm run lint
npm run test:agent
cd ..
npm run build
firebase deploy --only functions,firestore:rules,storage
```

Functions nuevas o extendidas:

- `whatsappWebhook`
- `processAccountingAgentWhatsappEvent`
- `updateAccountingAgentDraft`
- `confirmAccountingAgentDraft`
- `rejectAccountingAgentDraft`
- `retryAccountingAgentItem`
- `adminSaveAccountingAgentAuthorizedUser`
- `adminDeleteAccountingAgentAuthorizedUser`
- `adminSaveAccountingAgentRule`
- `adminDeleteAccountingAgentRule`
- `adminSeedAccountingAgentRules`

## Configuracion en Meta

No se cambia la URL actual:

```text
https://us-central1-sistema-contable-csm-granada.cloudfunctions.net/whatsappWebhook
```

En Meta Developers:

1. Mantener el verify token que corresponde a `WHATSAPP_VERIFY_TOKEN`.
2. Suscribir el campo `messages` de la cuenta de WhatsApp.
3. Confirmar que el App Secret de la aplicacion sea el configurado como `META_APP_SECRET`.
4. Usar un access token de sistema con acceso a la cuenta y numero de WhatsApp.
5. No pegar tokens en el frontend o archivos versionados.

## Primera prueba

1. Entrar con el usuario master.
2. Abrir `Ingresar Datos > Agente IA > Usuarios autorizados`.
3. Agregar el numero con codigo de pais, por ejemplo `50588888888`.
4. Abrir `Reglas` y ejecutar `Inicializar reglas base` una sola vez.
5. Enviar una foto JPG/PNG o PDF desde ese numero.
6. Revisar el borrador en Bandeja.
7. Corregir los datos pendientes y guardar.
8. Confirmar solo cuando el estado sea `Listo para confirmar`.
9. Verificar el registro en Compras o Gastos y, segun el pago, su espejo en CxP o Caja Chica.

## Estados

`RECEIVED`, `PROCESSING`, `NEEDS_INFORMATION`, `READY_FOR_CONFIRMATION`, `POSSIBLE_DUPLICATE`, `CONFIRMED`, `REGISTERED`, `REJECTED`, `ERROR`.

## Operacion segura

- Un `messageId` de Meta crea un solo evento.
- Un borrador usa un ID estable y registra un documento final estable.
- Reintentar no duplica compras, gastos, CxP ni Caja Chica.
- Los archivos permitidos son JPG, PNG y PDF, maximo 10 MB.
- Audio/voice queda preparado como tipo de mensaje, pero no se procesa en esta version.
- Un proveedor nuevo nunca se crea automaticamente.
- Una retencion requiere soporte o confirmacion explicita.
- Una confianza menor a 90% nunca habilita el registro.

## Pruebas

Las pruebas deterministas estan en `functions/tests/accountingAgent.test.js` y cubren firma Meta, archivos, reglas fijas, categorias, metodos de pago, montos, IVA, retenciones, sucursales, duplicados, confianza y comandos conversacionales.
