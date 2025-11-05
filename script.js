let session = null;
let inputImage = null;

const fileInput = document.getElementById("fileInput");
const removeBgBtn = document.getElementById("removeBgBtn");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const modelProgress = document.getElementById("model-progress");
const processProgress = document.getElementById("process-progress");
const processContainer = document.getElementById("process-container");
const downloadLink = document.getElementById("downloadLink");
const MODEL_KEY = "u2net-model";

// === Funciones para guardar / cargar en IndexedDB ===
function saveToIndexedDB(arrayBuffer) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("ModelDB", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("models");
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("models", "readwrite");
      tx.objectStore("models").put(arrayBuffer, MODEL_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = reject;
    };
  });
}

function loadFromIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("ModelDB", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("models");
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("models", "readonly");
      const getReq = tx.objectStore("models").get(MODEL_KEY);
      getReq.onsuccess = () => resolve(getReq.result);
      getReq.onerror = reject;
    };
  });
}

// === Descarga con progreso visible ===
async function fetchModelWithProgress(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Error al descargar el modelo");
  const total = +response.headers.get("Content-Length") || 0;
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total) {
      const percent = ((received / total) * 100).toFixed(1);
      modelProgress.style.width = `${percent}%`;
    }
  }

  const blob = new Blob(chunks);
  return await blob.arrayBuffer();
}

// === Cargar el modelo (desde cache o red) ===
async function loadModel() {
  try {
    document.querySelector(".progress-container label").textContent = "📦 Cargando modelo...";
    let buffer = await loadFromIndexedDB();

    if (!buffer) {
      console.log("Descargando modelo desde el servidor...");
      const modelUrl = "Model/u2net.onnx"; // ruta local a tu archivo subido
      buffer = await fetchModelWithProgress(modelUrl);
      await saveToIndexedDB(buffer);
      console.log("Modelo guardado en IndexedDB");
    } else {
      modelProgress.style.width = "100%";
      console.log("Modelo cargado desde IndexedDB (memoria local)");
    }

    session = await ort.InferenceSession.create(buffer, { executionProviders: ["wasm"] });
    document.querySelector(".progress-container label").textContent = "✅ Modelo cargado";
    removeBgBtn.disabled = false;

  } catch (e) {
    console.error("Error al cargar el modelo:", e);
    alert("No se pudo cargar el modelo. Revisa la ruta /model/u2net.onnx");
  }
}
loadModel();

// === Subir imagen ===
fileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
    inputImage = img;
  };
  img.src = URL.createObjectURL(file);
});

// === Procesar imagen ===
removeBgBtn.addEventListener("click", async () => {
  if (!session || !inputImage) return alert("Falta imagen o modelo");

  processContainer.classList.remove("hidden");
  processProgress.style.width = "0%";

  let progress = 0;
  const interval = setInterval(() => {
    if (progress < 90) {
      progress += 5;
      processProgress.style.width = progress + "%";
    }
  }, 150);

  const tensor = await imageToTensor(inputImage);
  const results = await session.run({ input: tensor });

  clearInterval(interval);
  processProgress.style.width = "100%";
  document.querySelector("#process-container label").textContent = "✅ Fondo eliminado";

  const output = results.output.data;
  drawMask(output, inputImage.width, inputImage.height);
});

async function imageToTensor(img) {
  const tmpCanvas = document.createElement("canvas");
  tmpCanvas.width = 320;
  tmpCanvas.height = 320;
  const tmpCtx = tmpCanvas.getContext("2d");
  tmpCtx.drawImage(img, 0, 0, 320, 320);
  const imageData = tmpCtx.getImageData(0, 0, 320, 320);
  const data = Float32Array.from(imageData.data).filter((_, i) => i % 4 !== 3);
  return new ort.Tensor("float32", data, [1, 3, 320, 320]);
}

function drawMask(mask, width, height) {
  const imgData = ctx.getImageData(0, 0, width, height);
  const pixels = imgData.data;
  for (let i = 0; i < width * height; i++) {
    const alpha = mask[i] * 255;
    pixels[i * 4 + 3] = alpha;
  }
  ctx.putImageData(imgData, 0, 0);
  canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    downloadLink.href = url;
    downloadLink.classList.remove("hidden");
  });
}
