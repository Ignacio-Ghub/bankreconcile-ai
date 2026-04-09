# BankReconcile AI

Demo interactiva de **conciliación bancaria automatizada con IA**, que replica el workflow n8n con Google Drive + GPT-4o + Google Sheets.

## ¿Qué hace esta app?

Simula el pipeline completo de conciliación bancaria:

1. **Carga una factura** — imagen JPG/PNG de una factura real (no PDF)
2. **Extracción con GPT-4o** — la IA lee la imagen y extrae automáticamente el proveedor y el importe total a pagar (con impuestos)
3. **Cruce bancario** — compara el importe extraído contra una tabla de movimientos bancarios editables (tolerancia ±0.02€)
4. **Resultado** — muestra si la factura quedó Conciliada ✅ o Pendiente ❌, con alerta visual si el gasto supera 1.000€

Todo el proceso queda registrado en un **log trazable** en tiempo real.

## Limitaciones conocidas

- **Solo imágenes** (JPG, PNG, WEBP) — OpenAI Vision no acepta PDF binario directamente. Para PDFs: hacer captura de pantalla y subirla como imagen.
- Los movimientos bancarios son editables manualmente en la app (en producción se conectarían a Google Sheets en tiempo real).

## Workflow n8n original que replica

```
Google Drive Trigger
  → Descargar Factura (PDF)
  → Extraer texto del PDF
  → GPT-4o (extraer proveedor + importe)
  → Parsear respuesta IA
  → Leer movimientos Banco (Google Sheets)
  → Conciliar (cruce por importe ±0.02€)
  → Actualizar estado en Google Sheets
  → ¿Gasto > 1.000€? → Email de alerta
  → Registrar Log en Google Sheets
```

## Stack

- **Next.js 15** — frontend + API route serverless
- **OpenAI GPT-4o Vision** — extracción de datos de facturas desde imagen
- **Vercel** — deploy con variable de entorno protegida (`OPENAI_API_KEY` nunca expuesta al cliente)

## Arquitectura de seguridad

```
Usuario (imagen)
  → Next.js frontend
    → /api/extract (serverless — API key protegida en servidor)
      → OpenAI GPT-4o
    → Cruce bancario (lógica en cliente)
  → Resultado
```

## Deploy en Vercel

1. Fork o clona este repo
2. Conecta en [vercel.com](https://vercel.com) → New Project → importa el repo
3. En **Environment Variables** añade:
   ```
   OPENAI_API_KEY = sk-...
   ```
4. Deploy

## Desarrollo local

```bash
npm install

# Crea .env.local con:
# OPENAI_API_KEY=sk-...

npm run dev
# Abre http://localhost:3000
```

## Mejoras futuras

- Soporte PDF real (vía conversión a imagen server-side)
- Conexión directa a Google Sheets para movimientos bancarios en tiempo real
- Historial de conciliaciones
- Exportar resultados a CSV

---

**Ignacio Briceño** · Portfolio de automatización e IA  
GPT-4o + n8n + Next.js + Vercel
