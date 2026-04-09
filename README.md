# BankReconcile AI

Demo interactiva de **conciliación bancaria automatizada con IA**, que replica el workflow n8n con Google Drive + GPT-4o + Google Sheets.

## Stack
- **Next.js 14** — frontend + API route proxy (la API key nunca sale del servidor)
- **OpenAI GPT-4o** — extracción de proveedor e importe de facturas
- **Vercel** — deploy con variable de entorno protegida

## Deploy en Vercel (5 minutos)

### 1. Sube a GitHub
```bash
git init
git add .
git commit -m "feat: bankreconcile ai demo"
gh repo create bankreconcile-ai --public --push
```

### 2. Conecta en Vercel
1. Ve a [vercel.com](https://vercel.com) → **New Project**
2. Importa el repo de GitHub
3. En **Environment Variables** añade:
   ```
   OPENAI_API_KEY = sk-proj-...
   ```
4. Click **Deploy** — listo en ~60 segundos

### 3. URL pública
Vercel te da una URL tipo `https://bankreconcile-ai.vercel.app`

## Desarrollo local
```bash
npm install
# crea .env.local con:
# OPENAI_API_KEY=sk-proj-...
npm run dev
# abre http://localhost:3000
```

## Cómo funciona
```
Usuario (imagen/texto factura)
  → /api/extract  (Vercel serverless — API key protegida)
    → OpenAI GPT-4o
  → Cruce contra movimientos bancarios
  → Resultado: Conciliado ✅ / Pendiente ❌ + alerta si > 1.000€
```

## Workflow n8n original
Esta demo replica el flujo:
`Google Drive Trigger → Descargar Factura → GPT-4o → Parsear → Leer Banco → Conciliar → Actualizar Sheets → Email alerta`

---
**Ignacio Briceño** · Portfolio de automatización e IA
