# Financiera privada (MVP local)

## Requisitos
- Node.js 18+
- Firebase CLI (`firebase` en PATH). Si no lo tenés, instalalo siguiendo la guía oficial.

## Instalar dependencias
```bash
cd functions
npm install

cd ../frontend
npm install
```

## Levantar emuladores
Desde la raíz:
```bash
firebase emulators:start
```

## Crear admin (solo local)
En otra terminal, con emuladores levantados:
```bash
cd frontend
node scripts/bootstrap-admin.mjs --email admin@mvprestamos.test --password Admin1234! --name "Admin Local"
```

Alternativa PowerShell (sin UI, recomendado):
```powershell
cd C:\Users\exequ\Desktop\financiera
.\bootstrap-admin.ps1
```

## Levantar frontend
En otra terminal:
```bash
cd frontend
npm run dev
```

## Migracion unknown -> cpmaron@gmail.com
Script idempotente para reasignar pagos/ledger con `createdByEmail` vacio o `unknown`.
Requiere credenciales locales de Firebase Admin (por ejemplo `GOOGLE_APPLICATION_CREDENTIALS`).

```bash
cd C:\Users\exequ\Desktop\financiera
node scripts/migrate-unknown-to-cpmaron.js
```

## Migracion historica de wallets (una sola vez)
Calcula el total historico de pagos y crea movimientos `migration` para sumarlo a `wallets.balanceArs`.
Requiere credenciales locales de Firebase Admin (por ejemplo `GOOGLE_APPLICATION_CREDENTIALS`).

```bash
cd C:\Users\exequ\Desktop\financiera
node scripts/migrate-wallet-history.js
```

## Crear usuario staff (Auth Emulator)
1. Abrí la UI de emuladores: http://localhost:4000
2. En **Authentication**, creá un usuario email/password.

## Habilitar usuario staff (Firestore Emulator)
1. En la UI de emuladores, abrí **Firestore**.
2. Creá un documento en `users/{uid}` con:
```json
{
  "active": true,
  "role": "admin"
}
```
Usá el `uid` del usuario creado en Auth. Roles permitidos: `admin` o `operator`.

## Notas
- `createLoan` y `addPayment` son Cloud Functions (callable) y calculan todo en backend.
- `bootstrapAdmin` es solo para emuladores y crea el usuario admin en Auth + Firestore.
- Reglas de seguridad bloquean escritura directa de `loans`, `payments` y `audit_logs`.
