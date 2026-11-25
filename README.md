# VidraCred

Proyecto de cuenta corriente comercial.

## Iniciar

Con Docker Desktop en ejecución, desde esta carpeta:

```powershell
# Solo si .env no existe:
Copy-Item .env.example .env
docker compose up -d --build
```

Abra **http://localhost:3000**. También puede usar `scripts/start.ps1`.

## Demostración con datos ficticios

Inicie el proyecto de defensa desde `vidracred` con su propio volumen y puertos.

```powershell
$env:APP_PORT = "3001"
$env:DB_PORT = "55433"
$env:SEED_DEMO = "1"
docker compose -p vidracred-defensa up -d --build
```

Abra **http://localhost:3001**. Use perfiles de navegador diferentes para Cliente y Tienda, o una ventana normal y una privada. Para Sistema puede reutilizar la ventana de Tienda después de cerrar su sesión.

| Rol | Correo de demostración |
| --- | --- |
| Sistema | sistema@vidracred.local |
| Tienda | tienda@vidracred.local |
| Cliente | cliente@vidracred.local |
| Otra tienda | aurora@vidracred.local |

La contraseña inicial de las cuentas ficticias es `Vidra2026!`. Se puede configurar `DEMO_PASSWORD` antes de la primera carga.

1. Cliente. En el catálogo, cotice **Frascos de vidrio de 20 ml** a dos meses y envíe la solicitud.
2. Tienda. Abra la solicitud, revise la cotización y apruébela. Cliente puede abrir el mismo contrato desde **Mis solicitudes**.
3. Tienda. En **Créditos**, abra **Envases para cosmética** (`VC-000002`) y registre la cuota vencida. Revise la línea disponible y el Corte mensual.
4. Sistema. Abra los catálogos de **Vidra Envases Demo** y **Bodega Aurora Demo**. Entre al **Simulador** desde la cabecera. M1 presenta 11 días de desfase, saldo inicial de **S/ 2,011.17** y cuota base de **S/ 691.02**. Expanda la primera cuota, ingrese `800` y pulse Enter.

Para una instalación vacía, use `SEED_DEMO=0` y configure `DEMO_PASSWORD` para el primer acceso de Sistema.

## Funcionamiento

Las nuevas ventas en cuotas usan frecuencia mensual. Los contratos históricos conservan su frecuencia original. La tienda gestiona las condiciones de la compra, aprueba las solicitudes y registra el cobro de la primera cuota pendiente desde su vencimiento. La huella de la cotización impide aprobar una solicitud con condiciones distintas. El simulador edita escenarios en memoria y muestra la fórmula de cada cuota.

## Comprobar

```powershell
npm run verify
npm run test:views
$env:TEST_ORIGIN = "http://localhost:3001"
npm run test:http
```

Ejecute HTTP contra una instancia de prueba. El conjunto de integración crea su propia base temporal en el PostgreSQL configurado. Para apuntar el resto de pruebas a la demostración, configure `DATABASE_URL` con su puerto antes de ejecutarlas.

Los CSV y JSON de [casos](docs) se regeneran con `npx tsx scripts/export-monthly-cases.ts`, `npx tsx scripts/export-extra-cases.ts` y `npx tsx --env-file=.env scripts/export-cases.ts`. Ejecute la exportación histórica sobre la base ficticia.

## Datos y respaldos

PostgreSQL conserva los datos en el volumen de Docker. `docker compose stop` detiene el proyecto sin borrarlos. Los scripts `backup.ps1` y `restore.ps1` permiten respaldar y recuperar la base; los respaldos existentes se conservan en `backups`.



