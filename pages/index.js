import Head from 'next/head'
import { useState, useRef } from 'react'

const DEFAULT_BANK = [
  { concepto: 'Pago nóminas', importe: '3500.00' },
  { concepto: 'Suministros Tech S.L.', importe: '1452.00' },
  { concepto: 'Alquiler oficina', importe: '900.00' },
  { concepto: 'Proveedor XYZ', importe: '750.50' },
  { concepto: 'Factura servicios cloud', importe: '249.99' },
  { concepto: 'Seguro resp. civil', importe: '87.00' },
]

export default function Home() {
  const [bank, setBank] = useState(DEFAULT_BANK)
  const [invoiceText, setInvoiceText] = useState('')
  const [fileInfo, setFileInfo] = useState(null)
  const [fileB64, setFileB64] = useState(null)
  const [fileType, setFileType] = useState(null)
  const [step, setStep] = useState(0)
  const [status, setStatus] = useState({ msg: 'Carga una factura (imagen/texto) y pulsa Ejecutar.', type: '' })
  const [logs, setLogs] = useState([])
  const [result, setResult] = useState(null)
  const [running, setRunning] = useState(false)
  const [activeTab, setActiveTab] = useState('factura')
  const fileRef = useRef()

  function addLog(msg, type = '') {
    const t = new Date().toLocaleTimeString('es-ES')
    setLogs(prev => [...prev.slice(-29), { t, msg, type }])
  }

  function handleFile(file) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const parts = ev.target.result.split(',')
      setFileB64(parts[1])
      setFileType(file.type)
      setFileInfo(`${file.name} · ${Math.round(file.size / 1024)} KB`)
      addLog(`Archivo cargado: ${file.name} (${file.type})`, 'info')
      setStep(1)
    }
    reader.readAsDataURL(file)
  }

  function updateBank(i, field, val) {
    setBank(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: val } : r))
  }

  async function run() {
    if (running) return
    setRunning(true)
    setResult(null)
    setLogs([])
    setStep(2)
    setStatus({ msg: 'Paso 1 — Extrayendo datos de la factura con GPT-4o...', type: 'info' })
    addLog('Pipeline iniciado', 'info')

    const SYS = 'Eres un auditor financiero. Extrae de la factura: 1) razón social del proveedor, 2) importe total a pagar con impuestos. Devuelve ÚNICAMENTE JSON con "proveedor" (string) e "importe" (número). Sin texto adicional.'

    let messages
    const isPDF = fileType === 'application/pdf' || (fileType || '').includes('pdf')

    if (fileB64 && !isPDF) {
      addLog('Modo: imagen vía vision API · ' + fileType, 'info')
      messages = [{ role: 'user', content: [
        { type: 'image_url', image_url: { url: `data:${fileType};base64,${fileB64}` } },
        { type: 'text', text: SYS }
      ]}]
    } else if (invoiceText.trim()) {
      addLog('Modo: texto directo (' + invoiceText.length + ' chars)')
      messages = [{ role: 'user', content: SYS + '\n\nTexto:\n' + invoiceText }]
    } else if (isPDF) {
      setStatus({ msg: 'OpenAI Vision no acepta PDF binario. Pega el texto del PDF en el textarea.', type: 'err' })
      setRunning(false)
      return
    } else {
      setStatus({ msg: 'Carga una imagen o pega el texto de la factura.', type: 'err' })
      setRunning(false)
      return
    }

    let inv = { proveedor: 'Desconocido', importe: 0 }
    try {
      addLog('Llamando /api/extract → GPT-4o...')
      const resp = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o', max_tokens: 300, temperature: 0, messages })
      })
      const data = await resp.json()
      if (data.error) throw new Error(data.error)
      const raw = data.choices?.[0]?.message?.content || ''
      addLog('Respuesta IA: ' + raw.slice(0, 100))
      try {
        const clean = raw.replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim()
        const parsed = JSON.parse(clean)
        inv.proveedor = parsed.proveedor || parsed.Proveedor || 'Desconocido'
        inv.importe = parseFloat(parsed.importe || parsed.Importe || 0)
        addLog(`Extraído → ${inv.proveedor} | ${inv.importe}€`, 'ok')
      } catch {
        const pm = raw.match(/"proveedor"\s*:\s*"([^"]+)"/i)
        const im = raw.match(/"importe"\s*:\s*([\d.,]+)/i)
        inv.proveedor = pm ? pm[1] : 'Desconocido'
        inv.importe = im ? parseFloat(im[1].replace(',', '.')) : 0
        addLog('Regex fallback → ' + inv.proveedor + ' ' + inv.importe + '€', 'warn')
      }
    } catch (err) {
      addLog('ERROR: ' + err.message, 'err')
      setStatus({ msg: 'Error: ' + err.message, type: 'err' })
      setRunning(false)
      return
    }

    setStep(3)
    setStatus({ msg: 'Paso 2 — Cruzando contra movimientos bancarios...', type: 'info' })
    addLog('Cruce bancario iniciado · tolerancia ±0.02€')
    await new Promise(r => setTimeout(r, 350))

    const TOL = 0.02
    let conciliado = false
    const rows = bank.map((r, i) => {
      const imp = parseFloat(String(r.importe).replace(',', '.'))
      const match = !isNaN(imp) && Math.abs(imp - inv.importe) <= TOL
      if (match) conciliado = true
      addLog(`Fila ${i + 2}: "${r.concepto}" ${imp}€ ${match ? '→ MATCH ✅' : '→ sin coincidencia'}`)
      return { ...r, imp, match }
    })

    await new Promise(r => setTimeout(r, 250))
    setStep(4)
    addLog('Pipeline completado.', 'ok')
    if (inv.importe > 1000) addLog('ALERTA: Gasto >1.000€ — el workflow n8n enviaría email de alerta.', 'warn')
    setStatus({
      msg: conciliado
        ? `✅ Conciliación exitosa — ${inv.proveedor} (${inv.importe.toFixed(2)}€)`
        : `❌ Sin coincidencia — ${inv.proveedor} (${inv.importe.toFixed(2)}€)`,
      type: conciliado ? 'ok' : 'err'
    })
    setResult({ inv, rows, conciliado })
    setActiveTab('resultado')
    setRunning(false)
  }

  const steps = ['Factura', 'Extracción IA', 'Conciliación', 'Resultado']

  return (
    <>
      <Head>
        <title>BankReconcile AI — Demo de Automatización</title>
        <meta name="description" content="Demo interactiva de conciliación bancaria automatizada con IA. Powered by OpenAI GPT-4o + n8n." />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@600;700;800&display=swap" rel="stylesheet" />
      </Head>

      <style>{`
        :root{--bg:#0a0a0f;--surface:#111118;--surface2:#1a1a24;--border:rgba(255,255,255,0.07);--border-hi:rgba(255,255,255,0.14);--accent:#4ade80;--accent2:#22d3ee;--warn:#fb923c;--danger:#f87171;--text:#f0f0f5;--text2:#8888aa;--text3:#44445a}
        .shell{max-width:980px;margin:0 auto;padding:2rem 1.5rem 5rem;position:relative;z-index:1}
        body::before{content:'';position:fixed;inset:0;background-image:linear-gradient(rgba(74,222,128,.015) 1px,transparent 1px),linear-gradient(90deg,rgba(74,222,128,.015) 1px,transparent 1px);background-size:40px 40px;pointer-events:none;z-index:0}

        /* header */
        .header{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:2.5rem;flex-wrap:wrap;gap:1rem}
        .brand{display:flex;align-items:center;gap:12px}
        .brand-icon{width:42px;height:42px;border:1px solid var(--accent);border-radius:8px;display:flex;align-items:center;justify-content:center;color:var(--accent);font-size:16px;flex-shrink:0}
        .brand h1{font-family:'Syne',sans-serif;font-size:1.3rem;font-weight:700;letter-spacing:-.02em}
        .brand p{font-size:.65rem;color:var(--text2);margin-top:2px;letter-spacing:.08em;text-transform:uppercase}
        .badge-n8n{font-size:.6rem;padding:3px 10px;border-radius:20px;border:1px solid rgba(251,146,60,.3);color:var(--warn);letter-spacing:.06em;text-transform:uppercase;margin-top:6px;display:inline-block}

        /* stepper */
        .stepper{display:flex;align-items:center;margin-bottom:2.5rem}
        .st{display:flex;align-items:center;gap:8px;flex:1}
        .st-num{width:26px;height:26px;border-radius:50%;border:1px solid var(--border-hi);display:flex;align-items:center;justify-content:center;font-size:.65rem;color:var(--text3);transition:all .3s;flex-shrink:0}
        .st-lbl{font-size:.65rem;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;transition:all .3s;white-space:nowrap}
        .st-line{flex:1;height:1px;background:var(--border);margin:0 4px;max-width:50px}
        .st.active .st-num{border-color:var(--accent2);color:var(--accent2);background:rgba(34,211,238,.1)}
        .st.active .st-lbl{color:var(--accent2)}
        .st.done .st-num{border-color:var(--accent);background:var(--accent);color:#000}
        .st.done .st-lbl{color:var(--accent)}

        /* tabs */
        .tabs{display:flex;gap:4px;margin-bottom:14px}
        .tab{font-size:.72rem;padding:5px 14px;border-radius:8px;border:1px solid var(--border);cursor:pointer;background:var(--surface);color:var(--text2);transition:all .15s}
        .tab.on{background:var(--surface2);color:var(--text);border-color:var(--border-hi)}

        /* grid */
        .main-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}
        @media(max-width:660px){.main-grid{grid-template-columns:1fr}}

        /* panel */
        .panel{background:var(--surface);border:1px solid var(--border);border-radius:16px;overflow:hidden}
        .ph{padding:12px 18px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px}
        .ph-title{font-family:'Syne',sans-serif;font-size:.8rem;font-weight:600}
        .ph-badge{margin-left:auto;font-size:.58rem;padding:2px 8px;border-radius:20px;border:1px solid var(--border-hi);color:var(--text3);text-transform:uppercase;letter-spacing:.05em}
        .pb{padding:16px 18px}

        /* dropzone */
        .dz{border:1.5px dashed var(--border-hi);border-radius:8px;padding:1.8rem 1rem;text-align:center;cursor:pointer;transition:all .2s}
        .dz:hover,.dz.over{border-color:var(--accent2);background:rgba(34,211,238,.04)}
        .dz-ico{font-size:1.8rem;margin-bottom:6px}
        .dz-main{font-size:.75rem;color:var(--text2)}
        .dz-sub{font-size:.62rem;color:var(--text3);margin-top:3px}
        .file-ok{display:flex;align-items:center;gap:8px;background:rgba(74,222,128,.06);border:1px solid rgba(74,222,128,.2);border-radius:6px;padding:7px 12px;margin-top:10px;font-size:.7rem;color:var(--accent)}
        .divider-or{text-align:center;font-size:.62rem;color:var(--text3);letter-spacing:.1em;text-transform:uppercase;margin:10px 0;position:relative}
        .divider-or::before,.divider-or::after{content:'';position:absolute;top:50%;width:43%;height:1px;background:var(--border)}
        .divider-or::before{left:0}.divider-or::after{right:0}
        textarea{width:100%;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;color:var(--text);font-family:'DM Mono',monospace;font-size:.72rem;resize:vertical;outline:none;line-height:1.7}
        textarea:focus{border-color:var(--border-hi)}
        textarea::placeholder{color:var(--text3)}

        /* bank table */
        .bt{width:100%;border-collapse:collapse;font-size:.72rem}
        .bt th{color:var(--text3);font-weight:400;font-size:.6rem;letter-spacing:.06em;text-transform:uppercase;padding:0 0 8px;text-align:left;border-bottom:1px solid var(--border)}
        .bt td{padding:6px 0;border-bottom:1px solid var(--border)}
        .bt tr:last-child td{border-bottom:none}
        .bt input{background:transparent;border:none;outline:none;color:var(--text);font-family:'DM Mono',monospace;font-size:.72rem;width:100%}
        .bt input.amt{text-align:right;color:var(--text2)}
        .del-btn{background:none;border:none;cursor:pointer;color:var(--text3);font-size:.85rem;padding:0 4px;transition:color .15s}
        .del-btn:hover{color:var(--danger)}
        .add-btn{display:flex;align-items:center;justify-content:center;gap:6px;width:100%;background:none;border:1px dashed var(--border);border-radius:6px;color:var(--text3);font-family:'DM Mono',monospace;font-size:.68rem;padding:6px;cursor:pointer;margin-top:10px;transition:all .15s}
        .add-btn:hover{border-color:var(--accent);color:var(--accent)}

        /* run */
        .run-btn{width:100%;padding:13px;font-family:'Syne',sans-serif;font-size:.85rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;border:none;border-radius:10px;background:var(--accent);color:#000;cursor:pointer;transition:opacity .2s}
        .run-btn:hover{opacity:.88}
        .run-btn:disabled{background:var(--surface2);color:var(--text3);cursor:default}

        /* status */
        .status{display:flex;align-items:center;gap:10px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 16px;font-size:.72rem;color:var(--text2);min-height:42px}
        .s-dot{width:6px;height:6px;border-radius:50%;background:var(--text3);flex-shrink:0}
        .status.ok .s-dot{background:var(--accent)}
        .status.err .s-dot{background:var(--danger)}
        .status.info .s-dot{background:var(--accent2);animation:pulse 1s infinite}
        .status.ok .s-msg{color:var(--accent)}
        .status.err .s-msg{color:var(--danger)}
        .status.info .s-msg{color:var(--accent2)}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}

        /* metrics */
        .metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}
        @media(max-width:660px){.metrics{grid-template-columns:1fr 1fr}}
        .met{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px}
        .met-l{font-size:.58rem;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px}
        .met-v{font-size:1.05rem;font-family:'Syne',sans-serif;font-weight:700}
        .c-g{color:var(--accent)}.c-r{color:var(--danger)}.c-b{color:var(--accent2)}.c-w{color:var(--warn)}.c-t{color:var(--text)}

        /* result table */
        .rt-wrap{background:var(--surface);border:1px solid var(--border);border-radius:16px;overflow:hidden;margin-bottom:12px}
        .rt-head{display:flex;align-items:center;justify-content:space-between;padding:12px 18px;border-bottom:1px solid var(--border)}
        .rt-head span{font-family:'Syne',sans-serif;font-size:.8rem;font-weight:600}
        .r-badge{font-size:.6rem;padding:3px 10px;border-radius:20px;font-weight:500}
        .rb-ok{background:rgba(74,222,128,.12);color:var(--accent);border:1px solid rgba(74,222,128,.25)}
        .rb-fail{background:rgba(248,113,113,.12);color:var(--danger);border:1px solid rgba(248,113,113,.25)}
        table.rt{width:100%;border-collapse:collapse;font-size:.72rem}
        table.rt th{background:var(--surface2);color:var(--text3);font-weight:400;font-size:.6rem;letter-spacing:.07em;text-transform:uppercase;padding:8px 18px;text-align:left}
        table.rt td{padding:10px 18px;border-top:1px solid var(--border)}
        table.rt tr.match td{background:rgba(74,222,128,.04)}
        .pill{display:inline-flex;align-items:center;gap:4px;font-size:.62rem;padding:2px 8px;border-radius:20px}
        .p-ok{background:rgba(74,222,128,.1);color:var(--accent);border:1px solid rgba(74,222,128,.2)}
        .p-pend{background:rgba(136,136,170,.08);color:var(--text2);border:1px solid var(--border)}

        /* log */
        .log-wrap{background:var(--surface);border:1px solid var(--border);border-radius:16px;overflow:hidden}
        .log-head{padding:9px 18px;border-bottom:1px solid var(--border);font-size:.6rem;color:var(--text3);letter-spacing:.08em;text-transform:uppercase}
        .log-body{padding:10px 18px;max-height:140px;overflow-y:auto;display:flex;flex-direction:column;gap:3px}
        .log-line{font-size:.67rem;line-height:1.5}
        .log-line .ts{color:var(--text3);margin-right:8px}
        .log-line .lm{color:var(--text2)}
        .log-line.l-ok .lm{color:var(--accent)}
        .log-line.l-err .lm{color:var(--danger)}
        .log-line.l-info .lm{color:var(--accent2)}
        .log-line.l-warn .lm{color:var(--warn)}

        /* footer */
        footer{margin-top:3rem;padding-top:1.5rem;border-top:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;font-size:.62rem;color:var(--text3);flex-wrap:wrap;gap:.5rem}
      `}</style>

      <div className="shell">
        {/* HEADER */}
        <div className="header">
          <div className="brand">
            <div className="brand-icon">⟨/⟩</div>
            <div>
              <h1>BankReconcile AI</h1>
              <p>Conciliación bancaria automatizada</p>
              <span className="badge-n8n">Powered by n8n + GPT-4o</span>
            </div>
          </div>
          <div style={{ textAlign: 'right', fontSize: '.65rem', color: 'var(--text3)', lineHeight: 1.8 }}>
            <div>Esta demo replica el workflow n8n</div>
            <div>de conciliación bancaria con IA</div>
            <div style={{ color: 'var(--text2)', marginTop: 4 }}>Google Drive → GPT-4o → Google Sheets</div>
          </div>
        </div>

        {/* STEPPER */}
        <div className="stepper">
          {steps.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
              <div className={`st ${step > i + 1 ? 'done' : step === i + 1 ? 'active' : ''}`}>
                <div className="st-num">{step > i + 1 ? '✓' : i + 1}</div>
                <div className="st-lbl">{s}</div>
              </div>
              {i < steps.length - 1 && <div className="st-line" />}
            </div>
          ))}
        </div>

        {/* TABS */}
        <div className="tabs">
          {['factura', 'banco', 'resultado'].map(t => (
            <button key={t} className={`tab${activeTab === t ? ' on' : ''}`} onClick={() => setActiveTab(t)}>
              {t === 'factura' ? '📄 Factura' : t === 'banco' ? '🏦 Banco' : '📊 Resultado'}
            </button>
          ))}
        </div>

        {/* TAB: FACTURA */}
        {activeTab === 'factura' && (
          <div className="main-grid">
            <div className="panel">
              <div className="ph">
                <span style={{ fontSize: '.85rem' }}>📄</span>
                <span className="ph-title">Factura</span>
                <span className="ph-badge">Imagen / Texto</span>
              </div>
              <div className="pb">
                <div
                  className={`dz${fileB64 ? '' : ''}`}
                  onClick={() => fileRef.current?.click()}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]) }}
                >
                  <div className="dz-ico">⬆</div>
                  <div className="dz-main">Arrastra una imagen aquí</div>
                  <div className="dz-sub">PNG, JPG, WEBP · haz clic para seleccionar</div>
                </div>
                <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => handleFile(e.target.files[0])} />
                {fileInfo && <div className="file-ok"><span>✓</span><span>{fileInfo}</span></div>}
                <div className="divider-or">o pega el texto</div>
                <textarea
                  rows={6}
                  value={invoiceText}
                  onChange={e => setInvoiceText(e.target.value)}
                  placeholder={'Proveedor: Suministros Tech S.L.\nSubtotal: 1.200,00€\nIVA (21%): 252,00€\nTotal a pagar: 1.452,00€'}
                />
                <div style={{ fontSize: '.62rem', color: 'var(--text3)', marginTop: 8, lineHeight: 1.6 }}>
                  Para PDFs: abre el PDF y copia el texto aquí.
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="status info">
                <div className="s-dot" />
                <span className="s-msg" style={{ color: 'var(--accent2)', fontSize: '.7rem', lineHeight: 1.6 }}>
                  Este simulador reproduce el workflow n8n:<br />
                  Google Drive Trigger → GPT-4o → Google Sheets → Email alerta
                </span>
              </div>
              <div className="panel" style={{ flex: 1 }}>
                <div className="ph">
                  <span style={{ fontSize: '.85rem' }}>⚙️</span>
                  <span className="ph-title">Arquitectura n8n</span>
                </div>
                <div className="pb" style={{ fontSize: '.68rem', color: 'var(--text2)', lineHeight: 2 }}>
                  <div style={{ color: 'var(--accent)' }}>① Google Drive Trigger</div>
                  <div style={{ paddingLeft: 12, color: 'var(--text3)' }}>↓ Detecta nueva factura PDF</div>
                  <div style={{ color: 'var(--accent2)' }}>② Extraer Datos (GPT-4o)</div>
                  <div style={{ paddingLeft: 12, color: 'var(--text3)' }}>↓ Proveedor + importe</div>
                  <div style={{ color: 'var(--accent2)' }}>③ Leer Banco (Google Sheets)</div>
                  <div style={{ paddingLeft: 12, color: 'var(--text3)' }}>↓ Cruce por importe ±0.02€</div>
                  <div style={{ color: 'var(--warn)' }}>④ Alerta si gasto &gt; 1.000€</div>
                  <div style={{ paddingLeft: 12, color: 'var(--text3)' }}>↓ Email automático</div>
                  <div style={{ color: 'var(--accent)' }}>⑤ Log en Google Sheets</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB: BANCO */}
        {activeTab === 'banco' && (
          <div className="panel">
            <div className="ph">
              <span style={{ fontSize: '.85rem' }}>🏦</span>
              <span className="ph-title">Movimientos bancarios</span>
              <span className="ph-badge">Editable</span>
            </div>
            <div className="pb">
              <table className="bt">
                <thead><tr><th style={{ width: '55%' }}>Concepto</th><th style={{ textAlign: 'right', width: '35%' }}>Importe €</th><th style={{ width: '10%' }} /></tr></thead>
                <tbody>
                  {bank.map((r, i) => (
                    <tr key={i}>
                      <td><input value={r.concepto} onChange={e => updateBank(i, 'concepto', e.target.value)} placeholder="Concepto..." /></td>
                      <td><input className="amt" value={r.importe} onChange={e => updateBank(i, 'importe', e.target.value)} placeholder="0.00" /></td>
                      <td><button className="del-btn" onClick={() => setBank(prev => prev.filter((_, j) => j !== i))}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button className="add-btn" onClick={() => setBank(prev => [...prev, { concepto: '', importe: '' }])}>+ Añadir movimiento</button>
            </div>
          </div>
        )}

        {/* TAB: RESULTADO */}
        {activeTab === 'resultado' && result && (
          <>
            <div className="metrics">
              <div className="met"><div className="met-l">Proveedor</div><div className="met-v c-b" style={{ fontSize: '.85rem', wordBreak: 'break-word' }}>{result.inv.proveedor}</div></div>
              <div className="met"><div className="met-l">Importe</div><div className={`met-v ${result.inv.importe > 1000 ? 'c-r' : 'c-g'}`}>{result.inv.importe.toFixed(2)}€</div></div>
              <div className="met"><div className="met-l">Conciliado</div><div className={`met-v ${result.conciliado ? 'c-g' : 'c-r'}`}>{result.conciliado ? 'Sí ✓' : 'No ✗'}</div></div>
              <div className="met"><div className="met-l">Alerta</div><div className={`met-v ${result.inv.importe > 1000 ? 'c-w' : 'c-g'}`}>{result.inv.importe > 1000 ? '> 1.000€' : 'Normal'}</div></div>
            </div>
            <div className="rt-wrap">
              <div className="rt-head">
                <span>Resultado por movimiento</span>
                <span className={`r-badge ${result.conciliado ? 'rb-ok' : 'rb-fail'}`}>{result.conciliado ? 'Conciliado' : 'Pendiente'}</span>
              </div>
              <table className="rt">
                <thead><tr><th>#</th><th>Concepto</th><th style={{ textAlign: 'right' }}>Importe</th><th>Estado</th></tr></thead>
                <tbody>
                  {result.rows.map((r, i) => (
                    <tr key={i} className={r.match ? 'match' : ''}>
                      <td>{i + 2}</td>
                      <td>{r.concepto}</td>
                      <td style={{ textAlign: 'right' }}>{isNaN(r.imp) ? r.importe : r.imp.toFixed(2)}€</td>
                      <td><span className={`pill ${r.match ? 'p-ok' : 'p-pend'}`}>{r.match ? '✓ Conciliado' : 'Pendiente'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {activeTab === 'resultado' && !result && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '2rem', textAlign: 'center', color: 'var(--text3)', fontSize: '.75rem' }}>
            Ejecuta el pipeline primero para ver el resultado aquí.
          </div>
        )}

        {/* STATUS + RUN */}
        <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'center' }}>
          <div className={`status ${status.type}`}>
            <div className="s-dot" />
            <span className="s-msg">{status.msg}</span>
          </div>
          <button className="run-btn" onClick={run} disabled={running} style={{ width: 200 }}>
            {running ? '⟳ Procesando...' : '▶ Ejecutar'}
          </button>
        </div>

        {/* LOG */}
        {logs.length > 0 && (
          <div className="log-wrap" style={{ marginTop: 12 }}>
            <div className="log-head">▸ Log de operaciones</div>
            <div className="log-body">
              {logs.map((l, i) => (
                <div key={i} className={`log-line l-${l.type}`}>
                  <span className="ts">{l.t}</span>
                  <span className="lm">{l.msg}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <footer>
          <span>BankReconcile AI · Portfolio demo de automatización · Ignacio Briceño</span>
          <span>GPT-4o + n8n + Next.js · Vercel</span>
        </footer>
      </div>
    </>
  )
}
