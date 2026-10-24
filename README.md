# VidraCred · Backend

API y base de datos de VidraCred, aplicación de cuenta corriente para Vidra Plastic. Next.js (solo rutas `/api`), PostgreSQL y un motor financiero único con `decimal.js`.

La interfaz vive en el repositorio **Vidra-Cred-Frontend**, que llama a esta API a través de `BACKEND_URL`.

## Requisitos

- Docker Desktop en ejecución.
- Node.js 22 y npm, solo si se ejecutan pruebas o el servidor sin Docker.

## Configuración

```powershell
Copy-Item .env.example .env
```

Edite `.env` y reemplace `POSTGRES_PASSWORD` y `DEMO_PASSWORD`. Sin esos valores, Docker Compose no inicia. `APP_ORIGIN` debe ser el origen del frontend (por defecto `http://localhost:3001`).

## Iniciar

```powershell
docker compose up -d --build
```

La primera carga crea el esquema y las cuentas de demostración con `DEMO_PASSWORD`. Un reinicio no restablece datos.

Cuentas de demostración (correo, contraseña = `DEMO_PASSWORD`):

| Acceso | Correo |
| --- | --- |
| Tienda Vidra Plastic | `tienda@vidracred.local` |
| Administrador del sistema | `sistema@vidracred.local` |
| Cliente Carrillo | `cliente@vidracred.local` |
| Otra tienda de prueba | `aurora@vidracred.local` |

## Pruebas

```powershell
npm install
npm run verify
```

`test:integration` y `test:http` necesitan la base en ejecución y `.env`.

## Estructura

- `src/lib/finance.ts`: cálculos financieros (cronogramas, mora, estados de cuenta).
- `src/lib/service.ts`: reglas de negocio y consultas.
- `src/app/api/[...path]/route.ts`: endpoints HTTP.
- `db/001_schema.sql`: esquema de PostgreSQL.
- `scripts/`: carga inicial, respaldo y restauración.
