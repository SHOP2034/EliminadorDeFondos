// ===== CONFIG =====
const SPACE_ROOT = "https://eliminador-alejobarraza-u2net-onnx.hf.space";
const API_PREDICT = `${SPACE_ROOT.replace(/\/$/,'')}/api/predict/`;

// ===== DOM =====
const fileInput = document.getElementById("fileInput");
const removeBgBtn = document.getElementById("removeBgBtn");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const processProgress = document.getElementById("process-progress");
const processContainer = document.getElementById("process-container");
const downloadBtn = document.getElementById("downloadLink");

// status & logs (create if missing)
let statusText = document.getElementById("status");
if (!statusText) {
  statusText = document.createElement("p");
  statusText.id = "status";
  statusText.textContent = "🖼️ Esperando imagen...";
  statusText.style.fontWeight = "bold";
  document.querySelector(".container").appendChild(statusText);
}
let logBox = document.getElementById("logBox");
if (!logBox) {
  logBox = document.createElement("div");
  logBox.id = "logBox";
  logBox.style.cssText = "background:#111;color:#0f0;font-family:monospace;padding:8px;margin-top:10px;height:180px;overflow:auto;border-radius:6px";
  document.querySelector(".container").appendChild(logBox);
}
const addLog = (m,c="#0f0") => { const p=document.createElement("div"); p.style.color=c; p.textContent=m; logBox.appendChild(p); logBox.scrollTop=logBox.scrollHeight; console.log(m); };

// ===== utils =====
function blobToDataURL(blob){ return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(blob); }); }
function compressImage(img, quality=0.8){ return new Promise(res=>{ const off=document.createElement("canvas"); off.width=img.width; off.height=img.height; const c=off.getContext("2d"); c.drawImage(img,0,0); off.toBlob(b=>res(b),"image/jpeg",quality); }); }

// ===== simple direct post to /api/predict/ =====
async function postPredictDirect(base64) {
  addLog(`→ POST directo a ${API_PREDICT}`);
  try {
    const r = await fetch(API_PREDICT, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ data: [base64] })
    });
    const txt = await r.text();
    addLog(`← HTTP ${r.status} ${API_PREDICT}`);
    try {
      const j = JSON.parse(txt);
      addLog(`← JSON keys: ${Object.keys(j)}`);
      return { ok: r.ok, json: j, status: r.status };
    } catch {
      addLog(`← Respuesta no-JSON (preview): ${txt.slice(0,300)}`, "#ffb");
      return { ok: r.ok, text: txt, status: r.status };
    }
  } catch (e) {
    addLog(`✖ Error fetch directo: ${e.message}`, "#f55");
    return { ok:false, error:e };
  }
}

// ===== fallback detector (tu versión reducida) =====
async function detectAndCallEndpoint(base, base64Image){
  addLog("🔎 Fallback: detectando endpoint...");
  const routes = [
    `${base}/api/predict/`, `${base}/run/eliminar_fondo`, `${base}/run/predict`, `${base}/api/`
  ];
  const payloads = [{ data: [base64Image] }, { data: [base64Image], fn_index: 0 }];
  for(const route of routes){
    for(const p of payloads){
      addLog(`→ Probando ${route} payload keys: ${Object.keys(p)}`);
      try {
        const res = await fetch(route, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(p) });
        const txt = await res.text();
        addLog(`← ${res.status} ${route}`);
        try {
          const j = JSON.parse(txt);
          // buscar posible imagen
          const cand = j.data?.[1] || j.data?.[0] || j.output?.[0] || j?.[0];
          if (typeof cand === "string"){
            addLog("✅ Endpoint válido detectado");
            return { url: route, payload: p, imageBase64: cand, rawJson: j };
          }
        } catch {
          addLog("   (no JSON) preview: " + txt.slice(0,200), "#ffb");
        }
      } catch (e){ addLog(`✖ Error en ${route}: ${e.message}`, "#f55"); }
    }
  }
  throw new Error("No se encontró endpoint válido en fallback");
}

// ===== draw helper =====
function drawBase64(base64Image){
  const img = new Image();
  img.onload = () => {
    canvas.width = img.width; canvas.height = img.height;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(img,0,0);
    downloadBtn.href = base64Image; downloadBtn.style.display = "inline-block";
  };
  img.onerror = ()=> addLog("❌ No se pudo dibujar la imagen devuelta", "#f55");
  img.src = base64Image;
}

// ===== events =====
let inputImageElem = null;
fileInput.addEventListener('change', e=>{
  const f = e.target.files[0]; if(!f) return;
  const img = new Image();
  img.onload = ()=>{ canvas.width=img.width; canvas.height=img.height; ctx.drawImage(img,0,0); inputImageElem = img; statusText.textContent="✅ Imagen lista"; removeBgBtn.disabled=false; downloadBtn.style.display='none'; addLog(`📸 ${f.name} ${img.width}x${img.height}`); };
  img.src = URL.createObjectURL(f);
});

removeBgBtn.addEventListener('click', async ()=>{
  if(!inputImageElem) return alert("Subí una imagen primero");
  removeBgBtn.disabled = true; logBox.innerHTML=''; addLog("🚀 Iniciando...");
  processContainer.style.display='block'; processProgress.style.width='0%';
  try {
    processProgress.style.width='10%'; statusText.textContent="🔄 Comprimiendo...";
    const blob = await compressImage(inputImageElem, 0.8);
    const base64 = await blobToDataURL(blob);
    processProgress.style.width='25%'; statusText.textContent="📤 Enviando directo a /api/predict/ ...";

    // 1) intentar directo
    const direct = await postPredictDirect(base64);
    if(direct.ok && direct.json && direct.json.data && typeof direct.json.data[0] === 'string'){
      addLog("✅ Respuesta válida (direct)");
      processProgress.style.width='100%'; statusText.textContent="✅ Fondo eliminado (direct)";
      drawBase64(direct.json.data[0]);
      removeBgBtn.disabled = false;
      return;
    }
    addLog("⚠️ POST directo no devolvió imagen. Intentando fallback...");
    // 2) fallback
    const found = await detectAndCallEndpoint(SPACE_ROOT, base64);
    processProgress.style.width='100%'; statusText.textContent="✅ Fondo eliminado (fallback)";
    // normalize
    let out = found.imageBase64;
    if(!out.startsWith("data:image/") && /^[A-Za-z0-9+/=\s]+$/.test(out)) out = "data:image/png;base64," + out.replace(/\s+/g,'');
    drawBase64(out);
  } catch (e) {
    addLog("❌ Error general: " + (e.message||e), "#f55");
    statusText.textContent = "❌ " + (e.message||e);
  } finally {
    removeBgBtn.disabled = false;
  }
});