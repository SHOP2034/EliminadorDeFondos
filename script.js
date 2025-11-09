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

// Los inputs nuevos (si existen en el HTML)
const bgColorPicker = document.getElementById("bgColorPicker"); // input type=color (hidden)
const bgImageInput = document.getElementById("bgImageInput"); // input type=file (hidden)

// ===== Foreground (offscreen) =====
const fgCanvas = document.createElement("canvas");
const fgCtx = fgCanvas.getContext("2d");

// ===== Estado =====
let inputImageElem = null;           // original input antes de procesar
let processedImage = null;           // image resultante de la API (Image)
let originalProcessedImage = null;   // imagen base recortada (dataURL)
let isErasing = false;
let isDrawing = false;
let lastX = 0;
let lastY = 0;

let finalTransform = {
  tx: 0,
  ty: 0,
  scale: 1,
  rotation: 0
};
// ===== Transform (preview + aplicar) =====
let isTransforming = false;
let transform = {
  tx: 0,
  ty: 0,
  scale: 1,
  rotation: 0,
  lastTouches: []
};

// Mouse transform helpers
let isMouseTransform = false;
let lastMouse = null;

// ===== Background state =====
// { type: 'none'|'color'|'image', value: '#fff' OR bgImage (Image) }
let currentBg = { type: "none", value: null };
let bgImage = null;

// ===== Historial (guardamos fg + bg) =====
let historyStack = [];
let historyIndex = -1;
const MAX_HISTORY = 50;

function saveHistory() {
  try {
    const fgData = fgCtx.getImageData(0, 0, fgCanvas.width, fgCanvas.height);

    const bgCopy = (currentBg.type === "image")
      ? { type: "image", value: null }
      : { type: currentBg.type, value: currentBg.value };

    const transformCopy = {
      tx: finalTransform.tx,
      ty: finalTransform.ty,
      scale: finalTransform.scale,
      rotation: finalTransform.rotation
    };

    if (historyIndex < historyStack.length - 1) {
      historyStack = historyStack.slice(0, historyIndex + 1);
    }

    historyStack.push({
      fg: fgData,
      bg: bgCopy,
      transform: transformCopy
    });

    if (historyStack.length > MAX_HISTORY) {
      historyStack.shift();
    }

    historyIndex = historyStack.length - 1;
    updateUndoRedoButtons();

  } catch (e) {
    console.warn("saveHistory falló:", e);
  }
}

function updateUndoRedoButtons() {
  undoBtn.disabled = historyIndex <= 0;
  redoBtn.disabled = historyIndex >= historyStack.length - 1;
}

function undo() {
  if (historyIndex > 0) {
    historyIndex--;

    const state = historyStack[historyIndex];

    // restaurar máscara
    fgCanvas.width = state.fg.width;
    fgCanvas.height = state.fg.height;
    fgCtx.putImageData(state.fg, 0, 0);

    // restaurar fondo
    if (state.bg.type === "color") {
      currentBg = { type: "color", value: state.bg.value };
      if (bgColorPicker) bgColorPicker.value = state.bg.value;
    } else if (state.bg.type === "none") {
      currentBg = { type: "none", value: null };
    } else if (state.bg.type === "image") {
      currentBg = { type: "image", value: bgImage };
    }

    // restaurar transformación
    finalTransform = {
      tx: state.transform.tx,
      ty: state.transform.ty,
      scale: state.transform.scale,
      rotation: state.transform.rotation
    };

    redrawMain();
    updateDownloadLink();
    updateUndoRedoButtons();
    statusText.textContent = "↩️ Undo aplicado";
  }
}

function redo() {
  if (historyIndex < historyStack.length - 1) {
    historyIndex++;

    const state = historyStack[historyIndex];

    fgCanvas.width = state.fg.width;
    fgCanvas.height = state.fg.height;
    fgCtx.putImageData(state.fg, 0, 0);

    if (state.bg.type === "color") {
      currentBg = { type: "color", value: state.bg.value };
      if (bgColorPicker) bgColorPicker.value = state.bg.value;
    } else if (state.bg.type === "none") {
      currentBg = { type: "none", value: null };
    } else if (state.bg.type === "image") {
      currentBg = { type: "image", value: bgImage };
    }

    finalTransform = {
      tx: state.transform.tx,
      ty: state.transform.ty,
      scale: state.transform.scale,
      rotation: state.transform.rotation
    };

    redrawMain();
    updateDownloadLink();
    updateUndoRedoButtons();
    statusText.textContent = "↪️ Redo aplicado";
  }
}

// ===== Utils =====
function blobToDataURL(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

function getCanvasPosition(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY
  };
}

// Convierte coordenadas del puntero (clientX,clientY) a coordenadas del fgCanvas
// tomando en cuenta la transformación acumulada final + la transformación en vivo (si la pasás).
function screenToFgCoords(clientX, clientY, live = { tx:0, ty:0, scale:1, rotation:0 }) {
  const p = getCanvasPosition(clientX, clientY);

  // total transform = finalTransform + live
  const total = {
    tx: (finalTransform.tx || 0) + (live.tx || 0),
    ty: (finalTransform.ty || 0) + (live.ty || 0),
    scale: (finalTransform.scale || 1) * (live.scale || 1),
    rotation: (finalTransform.rotation || 0) + (live.rotation || 0)
  };

  const cx = fgCanvas.width / 2;
  const cy = fgCanvas.height / 2;

  // coords relativas al centro
  let dx = p.x - cx - total.tx;
  let dy = p.y - cy - total.ty;

  // des-rotar (inversa)
  const cos = Math.cos(-total.rotation);
  const sin = Math.sin(-total.rotation);
  const rx = dx * cos - dy * sin;
  const ry = dx * sin + dy * cos;

  // des-escalar (inversa)
  const ox = rx / (total.scale || 1) + cx;
  const oy = ry / (total.scale || 1) + cy;

  return { x: ox, y: oy };
}

// ===== Preprocesado/compress =====
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
    data[i] = Math.min(255, Math.max(0, (data[i] - 128) * contrast + 128 + brightness));
    data[i + 1] = Math.min(255, Math.max(0, (data[i + 1] - 128) * contrast + 128 + brightness));
    data[i + 2] = Math.min(255, Math.max(0, (data[i + 2] - 128) * contrast + 128 + brightness));
  }
  ctxOff.putImageData(imgData, 0, 0);
  try { ctxOff.filter = "blur(0.6px)"; ctxOff.drawImage(off, 0, 0); ctxOff.filter = "none"; } catch {}
  return off;
}

function compressImage(img, quality = 0.85) {
  return new Promise(res => {
    const processed = preprocessImage(img);
    processed.toBlob(b => res(b), "image/jpeg", quality);
  });
}
// ===== API =====
async function postPredictDirect(base64) {
  try {
    const r = await fetch(API_PREDICT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: [base64] })
    });
    const txt = await r.text();
    try { return { ok: r.ok, json: JSON.parse(txt), status: r.status }; }
    catch { return { ok: r.ok, text: txt, status: r.status }; }
  } catch (e) { return { ok: false, error: e }; }
}

async function detectAndCallEndpoint(base, base64Image) {
  const routes = [`${base}/api/predict/`, `${base}/run/eliminar_fondo`, `${base}/run/predict`, `${base}/api/`];
  const payloads = [{ data: [base64Image] }, { data: [base64Image], fn_index: 0 }];
  for (const route of routes) {
    for (const p of payloads) {
      try {
        const res = await fetch(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
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

// ===== Composición final corregida =====
function drawTransformedComposite(ctxTarget, live = { tx:0, ty:0, scale:1, rotation:0 }) {
  if (!processedImage) return;

  const total = {
    tx: (finalTransform.tx || 0) + (live.tx || 0),
    ty: (finalTransform.ty || 0) + (live.ty || 0),
    scale: (finalTransform.scale || 1) * (live.scale || 1),
    rotation: (finalTransform.rotation || 0) + (live.rotation || 0)
  };

  const w = processedImage.width;
  const h = processedImage.height;
  const cx = w / 2;
  const cy = h / 2;

  // Componemos en un canvas temporal:
  const temp = document.createElement("canvas");
  temp.width = w;
  temp.height = h;
  const tctx = temp.getContext("2d");

  // 1) dibujar la imagen (completa)
  tctx.clearRect(0,0,w,h);
  tctx.drawImage(processedImage, 0, 0, w, h);

  // 2) usar fgCanvas (pintado en negro) como máscara para borrar en la imagen
  tctx.globalCompositeOperation = "destination-out";
  tctx.drawImage(fgCanvas, 0, 0, w, h);
  tctx.globalCompositeOperation = "source-over";

  // 3) dibujar el resultado transformado en el canvas objetivo
  ctxTarget.save();
  ctxTarget.translate(cx + total.tx, cy + total.ty);
  ctxTarget.rotate(total.rotation);
  ctxTarget.scale(total.scale, total.scale);
  ctxTarget.drawImage(temp, -cx, -cy);
  ctxTarget.restore();
}

// ===== redraw principal =====
function redrawMain(live = null) {
  if (!processedImage || !processedImage.complete) {
    // si no está lista la imagen, no dibujar
    return;
  }

  const w = processedImage.width;
  const h = processedImage.height;

  if (!w || !h) return;

  canvas.width = w;
  canvas.height = h;

  ctx.clearRect(0,0,w,h);

  // fondo
  if (currentBg.type === "color") {
    ctx.fillStyle = currentBg.value || "#ffffff";
    ctx.fillRect(0,0,w,h);
  } else if (currentBg.type === "image" && bgImage) {
    // ajustar imagen de fondo para cubrir (cover)
    const bw = bgImage.width;
    const bh = bgImage.height;
    const scale = Math.max(w / bw, h / bh);
    const nw = bw * scale;
    const nh = bh * scale;
    const ox = (w - nw) / 2;
    const oy = (h - nh) / 2;
    ctx.drawImage(bgImage, ox, oy, nw, nh);
  }

  // imagen transformada + máscara
  if (live)
    drawTransformedComposite(ctx, live);
  else
    drawTransformedComposite(ctx, { tx:0, ty:0, scale:1, rotation:0 });

  updateDownloadLink();
}

// ===== Dibujar imagen base (resultado API) en fgCanvas =====
function drawBase64(base64Image) {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    processedImage = img;

    // fgCanvas será la máscara/ediciones (vacía al inicio)
    fgCanvas.width = img.width;
    fgCanvas.height = img.height;
    fgCtx.clearRect(0, 0, fgCanvas.width, fgCanvas.height); // transparente inicialmente

    // originalProcessedImage puede usarse para restaurar
    originalProcessedImage = new Image();
    originalProcessedImage.src = base64Image;

    // reset transforms
    finalTransform = { tx:0, ty:0, scale:1, rotation:0 };
    transform = { tx:0, ty:0, scale:1, rotation:0, lastTouches: [] };

    // reset background
    currentBg = { type: "none", value: null };
    bgImage = null; // limpia bgImage cuando llega nueva imagen recortada

    // redraw: ahora usa processedImage para dibujar (no fgCanvas como fuente)
    redrawMain();

    editTools.classList.remove("hidden");
    downloadBtn.classList.remove("hidden");
    statusText.textContent = "✅ Fondo eliminado. Usá las herramientas para ajustar.";

    // reiniciar historial y guardar el estado inicial (fg vacío + bg + transform)
    historyStack = [];
    historyIndex = -1;
    saveHistory();
  };
  img.onerror = () => statusText.textContent = "❌ No se pudo dibujar la imagen devuelta";
  img.src = base64Image;
}

// ===== Goma: funciones (toque simple + arrastre) =====
function startDrawing(clientX, clientY) {
  if (!isErasing || !processedImage) return;

  const p = screenToFgCoords(clientX, clientY);
  isDrawing = true;
  lastX = p.x;
  lastY = p.y;

  // Pintamos un punto inicial (negro = máscara que luego será aplicada con destination-out)
  fgCtx.save();
  fgCtx.globalCompositeOperation = "source-over";
  fgCtx.fillStyle = "black";
  fgCtx.beginPath();
  fgCtx.arc(p.x, p.y, brushSize.value / 2, 0, Math.PI * 2);
  fgCtx.fill();
  fgCtx.restore();

  redrawMain();
}

function drawLine(clientX, clientY) {
  if (!isDrawing || !isErasing || !processedImage) return;
  const p = screenToFgCoords(clientX, clientY);

  fgCtx.save();
  fgCtx.globalCompositeOperation = "source-over";
  fgCtx.strokeStyle = "black";
  fgCtx.lineWidth = brushSize.value;
  fgCtx.lineCap = "round";
  fgCtx.lineJoin = "round";
  fgCtx.beginPath();
  fgCtx.moveTo(lastX, lastY);
  fgCtx.lineTo(p.x, p.y);
  fgCtx.stroke();
  fgCtx.restore();

  lastX = p.x;
  lastY = p.y;

  redrawMain();
}

function stopDrawing() {
  if (isDrawing) {
    saveHistory();
  }
  isDrawing = false;
}

// ===== Eventos mouse/touch (trabajan con fgCanvas coords) =====
canvas.addEventListener('mousedown', e => {
  if (isErasing) {
    startDrawing(e.clientX, e.clientY);
  } else if (processedImage) {
    isMouseTransform = true;
    lastMouse = { x: e.clientX, y: e.clientY };
    transform = { tx:0, ty:0, scale:1, rotation:0, lastTouches: [] };
  }
});

canvas.addEventListener('mousemove', e => {
  if (isDrawing && isErasing) {
    drawLine(e.clientX, e.clientY);
    return;
  }
  if (isMouseTransform && processedImage && !isErasing) {
    const dx = e.clientX - lastMouse.x;
    const dy = e.clientY - lastMouse.y;
    transform.tx += dx;
    transform.ty += dy;
    lastMouse = { x: e.clientX, y: e.clientY };
    redrawMain(transform);
  }
});

canvas.addEventListener('mouseup', e => {
  if (isDrawing) {
    stopDrawing();
  }

  if (isMouseTransform) {
    isMouseTransform = false;
    lastMouse = null;

    finalTransform.tx += transform.tx;
    finalTransform.ty += transform.ty;
    finalTransform.scale *= transform.scale;
    finalTransform.rotation += transform.rotation;

    transform = { tx:0, ty:0, scale:1, rotation:0, lastTouches: [] };

    saveHistory();
    redrawMain();
  }
});

canvas.addEventListener('mouseout', stopDrawing);

// Touch handlers
canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  if (!processedImage) return;
  if (isErasing) {
    const t = e.touches[0];
    startDrawing(t.clientX, t.clientY);
  } else {
    const touches = [...e.touches];
    transform.lastTouches = touches.map(t => ({ clientX: t.clientX, clientY: t.clientY }));
    isTransforming = true;
  }
}, { passive: false });

canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  if (!processedImage) return;

  if (isErasing) {
    const t = e.touches[0];
    drawLine(t.clientX, t.clientY);
    return;
  }

  if (!isTransforming) return;
  const touches = [...e.touches];

  // 1 dedo -> mover
  if (touches.length === 1 && transform.lastTouches.length === 1) {
    const t = touches[0];
    const lt = transform.lastTouches[0];
    const dx = t.clientX - lt.clientX;
    const dy = t.clientY - lt.clientY;
    transform.tx += dx;
    transform.ty += dy;
  }

  // 2 dedos -> scale + rotate
  if (touches.length === 2 && transform.lastTouches.length === 2) {
    const [t1, t2] = touches;
    const [l1, l2] = transform.lastTouches;
    const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const ang = (a, b) => Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX);

    const prevD = dist(l1, l2);
    const newD = dist(t1, t2);
    const scaleChange = newD / (prevD || 1);
    transform.scale *= scaleChange;

    const prevA = ang(l1, l2);
    const newA = ang(t1, t2);
    const aChange = newA - prevA;
    transform.rotation += aChange;
  }

  transform.lastTouches = touches.map(t => ({ clientX: t.clientX, clientY: t.clientY }));
  redrawMain(transform);
}, { passive: false });

canvas.addEventListener('touchend', e => {
  if (isDrawing) {
    stopDrawing();
  }

  if (isTransforming) {
    finalTransform.tx += transform.tx;
    finalTransform.ty += transform.ty;
    finalTransform.scale *= transform.scale;
    finalTransform.rotation += transform.rotation;

    transform = { tx:0, ty:0, scale:1, rotation:0, lastTouches: [] };

    saveHistory();
    redrawMain();

    isTransforming = false;
  }
});

// rueda para escalar (mouse)
canvas.addEventListener('wheel', e => {
  if (!processedImage) return;
  if (isErasing) return;
  e.preventDefault();
  const delta = -e.deltaY * 0.001;
  transform.scale *= (1 + delta);
  redrawMain(transform);
}, { passive:false });

// ===== Botones UI =====
eraserBtn.addEventListener('click', () => {
  isErasing = !isErasing;
  eraserBtn.classList.toggle('active', isErasing);
  canvas.style.cursor = isErasing ? 'crosshair' : 'default';
  statusText.textContent = isErasing ? "🧽 Modo goma activado" : "✅ Edición lista";
});

restoreBtn.addEventListener('click', () => {
  if (!originalProcessedImage) return;

  fgCanvas.width = originalProcessedImage.width;
  fgCanvas.height = originalProcessedImage.height;
  fgCtx.clearRect(0, 0, fgCanvas.width, fgCanvas.height);

  finalTransform = { tx:0, ty:0, scale:1, rotation:0 };
  transform = { tx:0, ty:0, scale:1, rotation:0, lastTouches: [] };
  currentBg = { type:"none", value:null };
  bgImage = null;

  saveHistory();
  redrawMain();

  statusText.textContent = "✅ Imagen restaurada al estado inicial";
});

clearBtn.addEventListener('click', () => {
  if (!confirm("¿Seguro que querés limpiar todo?")) return;

  fgCtx.clearRect(0, 0, fgCanvas.width, fgCanvas.height);
  currentBg = { type: "none", value: null };
  bgImage = null;
  if (bgColorPicker) bgColorPicker.value = "#ffffff";

  fileInput.value = '';
  removeBgBtn.disabled = true;
  downloadBtn.classList.add("hidden");
  editTools.classList.add("hidden");

  inputImageElem = processedImage = originalProcessedImage = null;
  historyStack = []; historyIndex = -1;
  updateUndoRedoButtons();

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  statusText.textContent = "🖼️ Esperando imagen...";
});

brushSize.addEventListener('input', () => { brushSizeValue.textContent = `${brushSize.value}px`; });
undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);

// ===== Fondo: cargar imagen (input visible en UI original, pero dejamos manejador por seguridad) =====
if (bgImageInput) {
  bgImageInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => {
      bgImage = img;
      statusText.textContent = "✅ Imagen de fondo cargada";
    };
    img.src = URL.createObjectURL(file);
  });
}

// ===== Fondo: aplicar COLOR/IMAGEN - handlers antiguos (si existen botones apply) =====
// En la versión actual no dependemos de botones apply separados; los manejadores
// modernos aplican inmediatamente al seleccionar color o imagen desde el panel lateral.

// ===== Cargar imagen original (antes de procesar) =====
fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => {
        inputImageElem = img;
        statusText.textContent = "✅ Imagen cargada. Lista para procesar.";
        removeBgBtn.disabled = false;
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
    };
    img.src = URL.createObjectURL(file);
});

// ===== Eliminar fondo (llama a la API y pone el recorte en fgCanvas) =====
removeBgBtn.addEventListener('click', async () => {
  if (!inputImageElem) return alert("Subí una imagen primero");
  removeBgBtn.disabled = true;
  processContainer.classList.remove("hidden");
  processProgress.style.width = '0%';
  try {
    processProgress.style.width = '10%';
    statusText.textContent = "🔄 Preprocesando...";
    const blob = await compressImage(inputImageElem, 0.85);
    const base64 = await blobToDataURL(blob);

    processProgress.style.width = '25%';
    statusText.textContent = "📤 Enviando a servidor...";

    const direct = await postPredictDirect(base64);
    if (direct.ok && direct.json && direct.json.data && typeof direct.json.data[0] === 'string') {
      processProgress.style.width = '100%';
      drawBase64(direct.json.data[0]);
      removeBgBtn.disabled = false;
      processContainer.classList.add("hidden");
      return;
    }

    const found = await detectAndCallEndpoint(SPACE_ROOT, base64);
    processProgress.style.width = '100%';
    let out = found.imageBase64;
    if (!out.startsWith("data:image/") && /^[A-Za-z0-9+/=\s]+$/.test(out)) out = "data:image/png;base64," + out.replace(/\s+/g, '');
    drawBase64(out);

  } catch (e) {
    statusText.textContent = "❌ Error: " + (e.message || e);
  } finally {
    removeBgBtn.disabled = false;
    processContainer.classList.add("hidden");
  }
});

// ===== Descargar =====
function updateDownloadLink() {
  try {
    downloadBtn.href = canvas.toDataURL('image/png');
  } catch (e) { /* canvas might estar vacío */ }
}

// =====================
// ===== PANEL LATERAL para agregar fondos (nuevo)
// =====================
document.addEventListener("DOMContentLoaded", () => {
  const addBgBtn = document.getElementById("addBgBtn");
  const bgOptions = document.getElementById("bgOptions");
  const bgColorBtn = document.getElementById("bgColorBtn");
  const bgImageBtn = document.getElementById("bgImageBtn");
  const bgColorPickerEl = document.getElementById("bgColorPicker");
  const bgImageInputEl = document.getElementById("bgImageInput");

  if (!addBgBtn || !bgOptions) return;

  let bgPanelVisible = false;
  addBgBtn.addEventListener("click", () => {
    bgPanelVisible = !bgPanelVisible;
    if (bgPanelVisible) {
      bgOptions.classList.remove("hidden");
      bgOptions.classList.add("slide-in");
      addBgBtn.textContent = "Agregar fondo ◂";
    } else {
      bgOptions.classList.add("hidden");
      bgOptions.classList.remove("slide-in");
      addBgBtn.textContent = "Agregar fondo ▸";
    }
  });

  // Al tocar "Agregar color" abrimos el selector nativo
  if (bgColorBtn && bgColorPickerEl) {
    bgColorBtn.addEventListener("click", () => {
      bgColorPickerEl.click();
    });

    // Selección inmediata del color: aplica, actualiza miniatura y cierra panel
    bgColorPickerEl.addEventListener("input", () => {
      if (!processedImage) return alert("Primero recortá una imagen");
      const color = bgColorPickerEl.value;
      currentBg = { type: "color", value: color };
      redrawMain();
      saveHistory();
      statusText.textContent = "🎨 Fondo color aplicado";

      // mostrar color en el botón
      bgColorBtn.style.background = color;
      bgColorBtn.style.color = getContrastYIQ(color);

      // cerrar panel automáticamente
      bgOptions.classList.add("hidden");
      bgOptions.classList.remove("slide-in");
      addBgBtn.textContent = "Agregar fondo ▸";
      bgPanelVisible = false;
    });
  }

  // Al tocar "Agregar imagen" abrimos selector de archivos y aplicamos directo
  if (bgImageBtn && bgImageInputEl) {
    bgImageBtn.addEventListener("click", () => {
      bgImageInputEl.click();
    });

    bgImageInputEl.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const img = new Image();
      img.onload = () => {
        bgImage = img;
        currentBg = { type: "image", value: bgImage };
        redrawMain();
        saveHistory();
        statusText.textContent = "🖼️ Fondo de imagen aplicado";

        // mostrar miniatura en el botón
        bgImageBtn.style.backgroundImage = `url(${img.src})`;
        bgImageBtn.style.backgroundSize = "cover";
        bgImageBtn.style.backgroundPosition = "center";
        bgImageBtn.style.color = "#fff";
        bgImageBtn.style.textShadow = "0 0 3px rgba(0,0,0,0.7)";

        // cerrar panel automáticamente
        bgOptions.classList.add("hidden");
        bgOptions.classList.remove("slide-in");
        addBgBtn.textContent = "Agregar fondo ▸";
        bgPanelVisible = false;
      };
      img.src = URL.createObjectURL(file);
    });
  }

  // contraste helper
  function getContrastYIQ(hexcolor) {
    hexcolor = hexcolor.replace("#", "");
    const r = parseInt(hexcolor.substr(0, 2), 16);
    const g = parseInt(hexcolor.substr(2, 2), 16);
    const b = parseInt(hexcolor.substr(4, 2), 16);
    const yiq = (r * 299 + g * 587 + b * 114) / 1000;
    return yiq >= 128 ? "#000" : "#fff";
  }
});