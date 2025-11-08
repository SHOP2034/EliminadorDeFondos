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
const statusText = document.getElementById("status");
const editTools = document.getElementById("edit-tools");
const eraserBtn = document.getElementById("eraserBtn");
const restoreBtn = document.getElementById("restoreBtn");
const clearBtn = document.getElementById("clearBtn");
const brushSize = document.getElementById("brushSize");
const brushSizeValue = document.getElementById("brushSizeValue");
const undoBtn = document.getElementById("undoBtn");
const redoBtn = document.getElementById("redoBtn");

// ===== Variables de estado =====
let inputImageElem = null;
let processedImage = null;
let originalProcessedImage = null;
let isErasing = false;
let isDrawing = false;
let lastX = 0;
let lastY = 0;

// Historial
let historyStack = [];
let historyIndex = -1;

// ===== Utils =====
function blobToDataURL(blob){ 
  return new Promise((res,rej)=>{
    const r=new FileReader();
    r.onload=()=>res(r.result);
    r.onerror=rej;
    r.readAsDataURL(blob);
  });
}

function getCanvasPosition(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
}

// ===== Preprocesado =====
function preprocessImage(img) {
  const off = document.createElement("canvas");
  const ctxOff = off.getContext("2d");
  off.width = img.width;
  off.height = img.height;
  ctxOff.drawImage(img, 0, 0);

  const imgData = ctxOff.getImageData(0, 0, off.width, off.height);
  const data = imgData.data;

  const contrast = 1.15;
  const brightness = 10;
  for (let i = 0; i < data.length; i += 4) {
    data[i]   = Math.min(255, Math.max(0, (data[i]-128)*contrast+128+brightness));
    data[i+1] = Math.min(255, Math.max(0, (data[i+1]-128)*contrast+128+brightness));
    data[i+2] = Math.min(255, Math.max(0, (data[i+2]-128)*contrast+128+brightness));
  }
  ctxOff.putImageData(imgData, 0, 0);

  try { ctxOff.filter = "blur(0.6px)"; ctxOff.drawImage(off,0,0); ctxOff.filter="none"; } catch{}

  return off;
}

function compressImage(img, quality=0.85){ 
  return new Promise(res=>{
    const processed = preprocessImage(img);
    processed.toBlob(b=>res(b),"image/jpeg",quality);
  });
}

// ===== API =====
async function postPredictDirect(base64) {
  try {
    const r = await fetch(API_PREDICT, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ data: [base64] })
    });
    const txt = await r.text();
    try { return { ok: r.ok, json: JSON.parse(txt), status: r.status }; } 
    catch { return { ok: r.ok, text: txt, status: r.status }; }
  } catch (e) { return { ok:false, error:e }; }
}

async function detectAndCallEndpoint(base, base64Image){
  const routes = [`${base}/api/predict/`, `${base}/run/eliminar_fondo`, `${base}/run/predict`, `${base}/api/`];
  const payloads = [{ data: [base64Image] }, { data: [base64Image], fn_index: 0 }];
  for(const route of routes){
    for(const p of payloads){
      try {
        const res = await fetch(route, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(p) });
        const txt = await res.text();
        try {
          const j = JSON.parse(txt);
          const cand = j.data?.[1] || j.data?.[0] || j.output?.[0] || j?.[0];
          if (typeof cand === "string") return { url: route, payload: p, imageBase64: cand, rawJson: j };
        } catch {}
      } catch {}
    }
  }
  throw new Error("No se encontró endpoint válido");
}

// ===== Dibujo base =====
function drawBase64(base64Image){
  const img = new Image();
  img.onload = () => {
    canvas.width = img.width; canvas.height = img.height;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(img,0,0);

    processedImage = img;
    originalProcessedImage = new Image();
    originalProcessedImage.src = base64Image;

    downloadBtn.href = base64Image; 
    downloadBtn.classList.remove("hidden");
    editTools.classList.remove("hidden");
    statusText.textContent = "✅ Fondo eliminado. Usá las herramientas para ajustar.";

    saveHistory();
    updateUndoRedoButtons();
  };
  img.onerror = ()=> statusText.textContent = "❌ No se pudo dibujar la imagen devuelta";
  img.src = base64Image;
}

// ===== Historial =====
function saveHistory() {
  if(historyIndex < historyStack.length - 1){
    historyStack = historyStack.slice(0, historyIndex + 1);
  }
  const snapshot = ctx.getImageData(0,0,canvas.width,canvas.height);
  historyStack.push(snapshot);
  historyIndex = historyStack.length - 1;
  updateUndoRedoButtons();
}

function undo(){
  if(historyIndex > 0){
    historyIndex--;
    ctx.putImageData(historyStack[historyIndex],0,0);
    updateDownloadLink();
    updateUndoRedoButtons();
    statusText.textContent="↩️ Undo aplicado";
  }
}

function redo(){
  if(historyIndex < historyStack.length - 1){
    historyIndex++;
    ctx.putImageData(historyStack[historyIndex],0,0);
    updateDownloadLink();
    updateUndoRedoButtons();
    statusText.textContent="↪️ Redo aplicado";
  }
}

function updateUndoRedoButtons(){
  undoBtn.disabled = historyIndex <= 0;
  redoBtn.disabled = historyIndex >= historyStack.length - 1;
}

// Activar modo goma: guardar snapshot inicial solo si no hay historial
function enableEraser(){
  if(historyStack.length === 0){
    saveHistory(); // Guardar estado inicial del canvas
  }
  isErasing = true;
  eraserBtn.classList.add('active');
  canvas.style.cursor = 'crosshair';
  canvas.style.touchAction = 'none';
  statusText.textContent = "🧽 Modo goma activado";
}

function startDrawing(x, y){
  if(!isErasing) return;

  isDrawing = true;
  lastX = x; lastY = y;

  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.arc(lastX, lastY, brushSize.value/2, 0, Math.PI*2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  updateDownloadLink();
}

function drawLine(x, y){
  if(!isDrawing || !isErasing) return;

  ctx.globalCompositeOperation = 'destination-out';
  ctx.lineWidth = brushSize.value;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(lastX, lastY);
  ctx.lineTo(x, y);
  ctx.stroke();

  lastX = x; lastY = y;
  ctx.globalCompositeOperation = 'source-over';
  updateDownloadLink();
}

// 🔹 Guardar estado **al final del trazo**, una sola vez
function stopDrawing(){
  if(isDrawing){
    saveHistory();
  }
  isDrawing = false;
}

// ===== Eventos mouse y touch =====
canvas.addEventListener('mousedown', e=>{ const pos=getCanvasPosition(e.clientX,e.clientY); startDrawing(pos.x,pos.y); });
canvas.addEventListener('mousemove', e=>{ const pos=getCanvasPosition(e.clientX,e.clientY); drawLine(pos.x,pos.y); });
canvas.addEventListener('mouseup', stopDrawing);
canvas.addEventListener('mouseout', stopDrawing);

canvas.addEventListener('touchstart', e=>{ e.preventDefault(); const t=e.touches[0]; const pos=getCanvasPosition(t.clientX,t.clientY); startDrawing(pos.x,pos.y); }, {passive:false});
canvas.addEventListener('touchmove', e=>{ e.preventDefault(); const t=e.touches[0]; const pos=getCanvasPosition(t.clientX,t.clientY); drawLine(pos.x,pos.y); }, {passive:false});
canvas.addEventListener('touchend', stopDrawing);

// ===== Botones UI =====
eraserBtn.addEventListener('click', ()=>{
  isErasing=!isErasing;
  eraserBtn.classList.toggle('active',isErasing);
  canvas.style.cursor=isErasing?'crosshair':'default';
  canvas.style.touchAction=isErasing?'none':'auto';
  statusText.textContent=isErasing?"🧽 Modo goma activado":"✅ Fondo eliminado. Usá las herramientas";
});

restoreBtn.addEventListener('click', ()=>{
  if(originalProcessedImage){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(originalProcessedImage,0,0);
    updateDownloadLink();
    saveHistory();
    statusText.textContent="✅ Imagen restaurada al estado original";
  }
});

clearBtn.addEventListener('click', ()=>{
  if(confirm("¿Seguro que querés limpiar todo?")){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    fileInput.value='';
    removeBgBtn.disabled=true;
    downloadBtn.classList.add("hidden");
    editTools.classList.add("hidden");
    isErasing=false; eraserBtn.classList.remove('active');
    canvas.style.cursor='default'; canvas.style.touchAction='auto';
    statusText.textContent="🖼️ Esperando imagen...";
    inputImageElem=processedImage=originalProcessedImage=null;
    historyStack=[]; historyIndex=-1;
    updateUndoRedoButtons();
  }
});

brushSize.addEventListener('input', ()=>{ brushSizeValue.textContent=`${brushSize.value}px`; });
undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);

// ===== Eventos archivo =====
fileInput.addEventListener('change', e=>{
  const f=e.target.files[0];
  if(!f) return;
  const img=new Image();
  img.onload=()=>{
    canvas.width=img.width; canvas.height=img.height;
    ctx.drawImage(img,0,0);
    inputImageElem=img;
    statusText.textContent="✅ Imagen lista"; 
    removeBgBtn.disabled=false;
    downloadBtn.classList.add('hidden'); editTools.classList.add('hidden');
    isErasing=false; eraserBtn.classList.remove('active');
    canvas.style.cursor='default'; canvas.style.touchAction='auto';
    historyStack=[]; historyIndex=-1;
    updateUndoRedoButtons();
  };
  img.src=URL.createObjectURL(f);
});

// ===== Eliminación de fondo =====
removeBgBtn.addEventListener('click', async ()=>{
  if(!inputImageElem) return alert("Subí una imagen primero");
  removeBgBtn.disabled=true; 
  processContainer.classList.remove("hidden");
  processProgress.style.width='0%';
  try {
    processProgress.style.width='10%'; 
    statusText.textContent="🔄 Preprocesando...";
    const blob = await compressImage(inputImageElem,0.85);
    const base64 = await blobToDataURL(blob);
    processProgress.style.width='25%'; statusText.textContent="📤 Enviando a servidor...";

    const direct = await postPredictDirect(base64);
    if(direct.ok && direct.json && direct.json.data && typeof direct.json.data[0]==='string'){
      processProgress.style.width='100%'; drawBase64(direct.json.data[0]);
      removeBgBtn.disabled=false; return;
    }

    const found = await detectAndCallEndpoint(SPACE_ROOT,base64);
    processProgress.style.width='100%'; 
    let out = found.imageBase64;
    if(!out.startsWith("data:image/") && /^[A-Za-z0-9+/=\s]+$/.test(out)) 
      out = "data:image/png;base64,"+out.replace(/\s+/g,'');
    drawBase64(out);

  } catch(e){
    statusText.textContent="❌ Error: "+(e.message||e);
  } finally{
    removeBgBtn.disabled=false;
  }
});

// ===== Descargar =====
function updateDownloadLink(){
  const dataURL = canvas.toDataURL('image/png');
  downloadBtn.href = dataURL;
}