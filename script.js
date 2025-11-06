// === CONFIGURACIÓN ===
const SPACE_URL = "https://Eliminador-alejobarraza-u2net-onnx.hf.space"; // tu Space Hugging Face
const fileInput = document.getElementById("fileInput");
const removeBgBtn = document.getElementById("removeBgBtn");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const processProgress = document.getElementById("process-progress");
const processContainer = document.getElementById("process-container");
const downloadBtn = document.getElementById("downloadLink");

// === Crear texto de estado ===
let statusText = document.getElementById("status");
if (!statusText) {
  statusText = document.createElement("p");
  statusText.id = "status";
  statusText.textContent = "🖼️ Esperando imagen...";
  statusText.style.marginTop = "10px";
  statusText.style.fontWeight = "bold";
  document.querySelector(".container").appendChild(statusText);
}

let inputImage = null;

// === Mostrar imagen cargada ===
fileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const img = new Image();
  img.onload = () => {
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    inputImage = img;
    statusText.textContent = "✅ Imagen lista para procesar.";
    removeBgBtn.disabled = false;
  };
  img.src = URL.createObjectURL(file);
});

// === Comprimir imagen ===
function compressImage(img, quality = 0.8) {
  return new Promise((resolve) => {
    const offCanvas = document.createElement("canvas");
    offCanvas.width = img.width;
    offCanvas.height = img.height;
    const ctx = offCanvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    offCanvas.toBlob((blob) => resolve(blob), "image/jpeg", quality);
  });
}

// === Animación "despertando servidor" ===
let wakeInterval = null;
function startWakeAnimation() {
  let dots = 0;
  statusText.style.color = "#ffa500";
  wakeInterval = setInterval(() => {
    dots = (dots + 1) % 4;
    statusText.textContent = "⚙️ Activando servidor" + ".".repeat(dots);
  }, 500);
}
function stopWakeAnimation(text, color = "limegreen") {
  clearInterval(wakeInterval);
  statusText.style.color = color;
  statusText.textContent = text;
}

// === Eliminar fondo usando Hugging Face ===
removeBgBtn.addEventListener("click", async () => {
  if (!inputImage) {
    alert("⚠️ Primero seleccioná una imagen.");
    return;
  }

  removeBgBtn.disabled = true;
  processContainer.classList.remove("hidden");
  processProgress.style.width = "0%";
  startWakeAnimation();

  try {
    // 1️⃣ Comprimir imagen
    const compressed = await compressImage(inputImage, 0.8);

    // 2️⃣ Preparar FormData
    const formData = new FormData();
    formData.append("image", compressed, "input.jpg"); // ✅ campo correcto

    // 3️⃣ Enviar al endpoint correcto de Gradio 4.x
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${SPACE_URL}/api/predict/`, true); // ✅ endpoint correcto

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const percent = ((e.loaded / e.total) * 50).toFixed(1);
        processProgress.style.width = `${percent}%`;
      }
    };

    xhr.onload = async () => {
      if (xhr.status !== 200) throw new Error("Error en el servidor GPU");

      stopWakeAnimation("🧠 Procesando imagen en GPU...");
      processProgress.style.width = "80%";

      const response = JSON.parse(xhr.responseText);
      const output = response.data?.[0];
      if (!output) throw new Error("El servidor no devolvió resultado");

      const img = new Image();
      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);

        processProgress.style.width = "100%";
        stopWakeAnimation("✅ Fondo eliminado correctamente.");

        // 🔹 Habilitar descarga
        canvas.toBlob((blob) => {
          const url = URL.createObjectURL(blob);
          downloadBtn.href = url;
          downloadBtn.download = "sin_fondo.png";
          downloadBtn.classList.remove("hidden");
        }, "image/png");

        removeBgBtn.disabled = false;
      };
      img.src = output;
    };

    xhr.onerror = () => {
      stopWakeAnimation("❌ Error al conectar con Hugging Face", "red");
      removeBgBtn.disabled = false;
    };

    xhr.send(formData);
  } catch (err) {
    console.error("Error:", err);
    stopWakeAnimation("❌ " + err.message, "red");
    removeBgBtn.disabled = false;
  }
});