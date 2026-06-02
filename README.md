# Capibara Bot

Bot de WhatsApp para solicitar y gestionar actas con panel web de administracion.

## Requisitos

- Node.js 20 o superior
- Un numero de WhatsApp para enlazar por QR

## Instalacion

```bash
npm install
npm run dev
```

Abre `http://localhost:3000`, escanea el QR desde WhatsApp y configura uno o mas grupos proveedores desde el panel.

## Configuracion

Variables opcionales:

```bash
PORT=3000
ADMIN_TOKEN=cambia-este-token
MEXICO_TZ=America/Mexico_City
```

El contador de actas se reinicia automaticamente por dia segun `America/Mexico_City`.

## Uso por WhatsApp

- `acta nombre-del-documento`: solicita un acta por nombre.
- `actas`: lista documentos disponibles.
- `saldo`: informa que cualquier integrante del grupo activo puede solicitar actas.

Activa un grupo enviando `activar` desde la cuenta conectada al bot. Cualquier integrante de un grupo activo puede solicitar actas.

## Proveedores

El panel permite seleccionar varios grupos proveedores o pegar sus JID, uno por linea. Cada solicitud se asigna al proveedor con menos pendientes y rota en empates; la respuesta del proveedor se entrega solo al grupo que origino esa solicitud.
