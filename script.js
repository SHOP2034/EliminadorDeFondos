const inputImage = document.getElementById('inputImage');
const removeBgBtn = document.getElementById('removeBgBtn');
const downloadBtn = document.getElementById('downloadBtn');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const statusDiv = document.getElementById('status');
const modelProgress = document.getElementById('modelProgress');
const processProgress = document.getElementById('processProgress');
const processContainer = document.getElementById('processContainer');

let image = new Image();
let model;

// Simular barra de progreso durante descarga del modelo
function simulateModelProgress() {
  let progress = 0;
  const interval = setInterval(() => {
    if (progress < 90) {
      progress += Math.random() * 5;
      modelProgress.style.width = progress + "%";
    }
  }, 200);
  return interval;
}

// Cargar modelo ONNX
async function loadModel() {
  const interval = simulateModelProgress();
  try {
    model = await ort.InferenceSession.create(
      "https://huggingface.co/briaai/RMBG-1.4/resolve/main/u2net.onnx"
    );
    clearInterval(interval);
    modelProgress.style.width = "100%";
    statusDiv.innerText = "Modelo cargado ✅";
    removeBgBtn.disabled = false;
  } catch (err) {
    clearInterval(interval);
    statusDiv.innerText = "Error al cargar el modelo. Probá subirlo a GitHub Pages.";
    console.error(err);
  }
}

loadModel();

inputImage.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    image.onload = () => {
      canvas.width = image.width;
      canvas.height = image.height;
      ctx.drawImage(image, 0, 0);
    };
    image.src = reader.result;
  };
  reader.readAsDataURL(file);
});

removeBgBtn.addEventListener('click', async () => {
  if (!image.src || !model) return alert("Subí una imagen y esperá que cargue el modelo.");

  processContainer.style.display = "block";
  processProgress.style.width = "0%";

  const updateProgress = (percent) => {
    processProgress.style.width = percent + "%";
  };

  updateProgress(10);

  // Redimensionar imagen para el modelo
  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = 320;
  tmpCanvas.height = 320;
  const tmpCtx = tmpCanvas.getContext('2d');
  tmpCtx.drawImage(image, 0, 0, 320, 320);
  const imgData = tmpCtx.getImageData(0, 0, 320, 320);

  updateProgress(40);

  // Normalizar imagen
  const input = new Float32Array(3 * 320 * 320);
  for (let i = 0; i < 320 * 320; i++) {
    input[i] = imgData.data[i * 4] / 255.0;
    input[i + 320 * 320] = imgData.data[i * 4 + 1] / 255.0;
    input[i + 2 * 320 * 320] = imgData.data[i * 4 + 2] / 255.0;
  }

  const tensor = new ort.Tensor('float32', input, [1, 3, 320, 320]);
  updateProgress(60);

  const output = await model.run({ 'input': tensor });
  updateProgress(80);

  const mask = output['output']?.data || output[Object.keys(output)[0]].data;

  // Aplicar máscara al tamaño original
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = 320;
  maskCanvas.height = 320;
  const maskCtx = maskCanvas.getContext('2d');
  const maskImg = maskCtx.createImageData(320, 320);
  for (let i = 0; i < 320 * 320; i++) {
    const v = Math.min(255, Math.max(0, mask[i] * 255));
    maskImg.data[i * 4] = v;
    maskImg.data[i * 4 + 1] = v;
    maskImg.data[i * 4 + 2] = v;
    maskImg.data[i * 4 + 3] = 255;
  }
  maskCtx.putImageData(maskImg, 0, 0);

  const finalCanvas = document.createElement('canvas');
  finalCanvas.width = image.width;
  finalCanvas.height = image.height;
  const fctx = finalCanvas.getContext('2d');
  fctx.drawImage(maskCanvas, 0, 0, image.width, image.height);
  const maskData = fctx.getImageData(0, 0, image.width, image.height);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0);
  const imgFinal = ctx.getImageData(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < imgFinal.data.length; i += 4) {
    imgFinal.data[i + 3] = maskData.data[i];
  }
  ctx.putImageData(imgFinal, 0, 0);

  updateProgress(100);
  downloadBtn.href = canvas.toDataURL('image/png');
  downloadBtn.style.display = "inline-block";
  statusDiv.innerText = "Fondo eliminado ✅";
});