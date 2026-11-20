'use strict';

const $ = id => document.getElementById(id);
const roomInput = $('roomPhoto');
const productInput = $('productPhoto');
const stage = $('roomStage');
const rooms = [];
const products = [];
let activeRoomId = null;
let pendingProduct = null;
let selectedId = null;
let classifierPromise = null;
let classifierQueue = Promise.resolve();
let activeModelStatus = null;
let nextRoomId = 1;
let nextProductId = 1;

const itemLabels = [
  'a toaster', 'a kettle', 'a microwave oven', 'cookware for a kitchen',
  'a sofa', 'an armchair', 'a bed', 'a bedside lamp', 'a dining table',
  'a dining chair', 'a desk', 'a framed art print', 'a rug', 'a houseplant',
  'a bathroom towel', 'a bathroom mirror', 'a floor lamp', 'a storage basket',
];

function activeRoom() { return rooms.find(room => room.id === activeRoomId) || null; }
function activeProduct() { return products.find(product => product.id === selectedId) || null; }

function setAnalysisBusy(button, status, busy, label) {
  button.dataset.idleLabel ||= button.textContent;
  button.disabled = busy;
  button.classList.toggle('is-loading', busy);
  button.setAttribute('aria-busy', String(busy));
  button.textContent = busy ? label : button.dataset.idleLabel;
  status.classList.toggle('is-loading', busy);
  status.setAttribute('aria-live', 'polite');
}

function imageFromFile(file, maxSide = 1100) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const ratio = Math.min(1, maxSide / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.width * ratio);
      canvas.height = Math.round(image.height * ratio);
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas);
    };
    image.onerror = () => { URL.revokeObjectURL(url); reject(Error('This image could not be opened.')); };
    image.src = url;
  });
}

function colorHex(r, g, b) {
  return `#${[r, g, b].map(value => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
}

async function findPalette(canvas, onProgress = () => {}) {
  const { data } = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
  const bins = new Map();
  const step = Math.max(1, Math.floor(Math.max(canvas.width, canvas.height) / 110));
  for (let y = 0; y < canvas.height; y += step) {
    for (let x = 0; x < canvas.width; x += step) {
      const i = (y * canvas.width + x) * 4;
      if (data[i + 3] < 100) continue;
      const key = `${data[i] >> 5},${data[i + 1] >> 5},${data[i + 2] >> 5}`;
      const bin = bins.get(key) || { n: 0, r: 0, g: 0, b: 0 };
      bin.n++; bin.r += data[i]; bin.g += data[i + 1]; bin.b += data[i + 2]; bins.set(key, bin);
    }
    if (y > 0 && y % (step * 24) === 0) {
      onProgress(Math.round(y / canvas.height * 100));
      await yieldToBrowser();
    }
  }
  return [...bins.values()].sort((a, b) => b.n - a.n).slice(0, 6).map(bin => colorHex(bin.r / bin.n, bin.g / bin.n, bin.b / bin.n));
}

function paletteDescription(colors) {
  if (!colors.length) return 'Could not read enough color information from this photo.';
  return `Most common sampled colors: ${colors.slice(0, 4).join(', ')}. These are rough image samples, affected by lighting and camera white balance.`;
}

function colorRGB(color) { return color.match(/[a-f\d]{2}/gi).map(part => parseInt(part, 16)); }

// A simple closest-palette-color score. It is a visual hint, not a trained style score.
function colorAffinity(itemColors, roomColors) {
  if (!itemColors.length || !roomColors.length) return 0;
  let closest = 441.7;
  for (const itemColor of itemColors.slice(0, 5)) for (const roomColor of roomColors.slice(0, 6)) {
    const a = colorRGB(itemColor), b = colorRGB(roomColor);
    const distance = Math.sqrt(a.reduce((sum, value, index) => sum + (value - b[index]) ** 2, 0));
    closest = Math.min(closest, distance);
  }
  return Math.round((1 - closest / 441.7) * 100);
}

function updatedRoomPalette(room, excludedProductId = null) {
  if (!room) return [];
  const sources = [
    { colors: room.palette, weight: 2 },
    ...products
      .filter(product => product.roomId === room.id && product.id !== excludedProductId)
      .map(product => ({ colors: product.palette, weight: 1 })),
  ];
  const bins = new Map();
  for (const source of sources) {
    source.colors.forEach((color, index) => {
      const [r, g, b] = colorRGB(color);
      const key = `${r >> 5},${g >> 5},${b >> 5}`;
      const bin = bins.get(key) || { weight: 0, r: 0, g: 0, b: 0 };
      const weight = source.weight * (source.colors.length - index);
      bin.weight += weight;
      bin.r += r * weight; bin.g += g * weight; bin.b += b * weight;
      bins.set(key, bin);
    });
  }
  return [...bins.values()]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 6)
    .map(bin => colorHex(bin.r / bin.weight, bin.g / bin.weight, bin.b / bin.weight));
}

function renderPalette(room) {
  const panel = $('palette');
  if (!room) { panel.hidden = true; return; }
  panel.hidden = false;
  $('paletteSwatches').innerHTML = room.palette.map(color => `<span class="palette-swatch" title="${color}" style="background:${color}"></span>`).join('');
  $('paletteText').textContent = paletteDescription(room.palette);
  const placedItems = products.filter(product => product.roomId === room.id);
  const updatedPalette = updatedRoomPalette(room);
  $('updatedPaletteSwatches').innerHTML = updatedPalette.map(color => `<span class="palette-swatch" title="${color}" style="background:${color}"></span>`).join('');
  $('updatedPaletteText').textContent = placedItems.length
    ? `Combines the base room colors with ${placedItems.length} placed ${placedItems.length === 1 ? 'item' : 'items'}: ${placedItems.map(product => product.name).join(', ')}. The base photo profile above remains unchanged.`
    : 'No items are placed in this room yet, so this profile currently matches the base room photo.';
}

roomInput.addEventListener('change', async () => {
  const file = roomInput.files?.[0];
  if (!file) return;
  if (!['image/jpeg', 'image/png'].includes(file.type)) { $('roomStatus').textContent = 'Choose a JPG or PNG room photo.'; return; }
  $('roomStatus').textContent = 'Adding room photo…';
  try {
    const canvas = await imageFromFile(file);
    const defaultName = `Room ${rooms.length + 1}`;
    const room = {
      id: nextRoomId++,
      name: $('roomName').value.trim() || defaultName,
      type: '',
      canvas,
      palette: await findPalette(canvas),
    };
    rooms.push(room);
    activeRoomId = room.id;
    $('roomName').value = '';
    roomInput.value = '';
    selectRoom(room.id);
    refreshAutoAssignments();
    renderStage(); renderProducts(); renderSuggestions(); updateMatch();
    $('roomStatus').textContent = `${room.name} saved for this session (${canvas.width} × ${canvas.height}px).`;
  } catch (error) { $('roomStatus').textContent = error.message; }
});

$('roomType').addEventListener('change', () => {
  const room = activeRoom();
  if (!room) return;
  room.type = $('roomType').value;
  refreshAutoAssignments();
  renderRooms();
  renderStage(); renderProducts(); renderSuggestions(); updateMatch();
});

function renderRooms() {
  const holder = $('savedRooms');
  if (!rooms.length) {
    holder.innerHTML = '<p class="empty-state">No saved rooms yet. Add a room photo above.</p>';
    $('removeRoom').disabled = true;
    $('activeRoomSelect').innerHTML = '<option value="">Add a room in step 1</option>';
    $('activeRoomSelect').disabled = true;
    $('activeRoomSummary').textContent = 'Choose which saved room to preview.';
    fillProductRoomSelect();
    return;
  }
  holder.innerHTML = rooms.map(room => `<button class="room-chip ${room.id === activeRoomId ? 'active' : ''}" type="button" data-id="${room.id}"><img src="${room.canvas.toDataURL('image/jpeg', .72)}" alt=""><span>${escapeHtml(room.name)}<br><small>${escapeHtml(room.type || 'Type not set')}</small></span></button>`).join('');
  holder.querySelectorAll('.room-chip').forEach(button => button.addEventListener('click', () => selectRoom(Number(button.dataset.id))));
  $('removeRoom').disabled = false;
  $('activeRoomSelect').innerHTML = rooms.map(room => `<option value="${room.id}">${escapeHtml(room.name)}${room.type ? ` · ${escapeHtml(room.type)}` : ''}</option>`).join('');
  $('activeRoomSelect').disabled = false;
  $('activeRoomSelect').value = String(activeRoomId);
  const selectedRoom = activeRoom();
  $('activeRoomSummary').textContent = selectedRoom ? `${selectedRoom.name}${selectedRoom.type ? ` · ${selectedRoom.type}` : ' · room type not analyzed yet'}` : 'Choose which saved room to preview.';
  fillProductRoomSelect();
}

function fillProductRoomSelect() {
  const select = $('productRoom');
  const product = activeProduct();
  select.innerHTML = `${product && !product.roomId ? '<option value="">Choose a room for this item</option>' : ''}${rooms.length
    ? rooms.map(room => `<option value="${room.id}">${escapeHtml(room.name)}${room.type ? ` · ${escapeHtml(room.type)}` : ''}</option>`).join('')
    : '<option value="">Add a room first</option>'}`;
  select.disabled = !product || !rooms.length;
  select.value = product?.roomId ? String(product.roomId) : '';
}

function selectRoom(id, preferredProductId = null) {
  activeRoomId = id;
  const room = activeRoom();
  if (!room) return;
  $('roomType').value = room.type;
  $('suggestRoom').disabled = false;
  $('roomStatus').textContent = `${room.name} selected.`;
  selectedId = products.some(product => product.id === preferredProductId && product.roomId === room.id)
    ? preferredProductId
    : products.find(product => product.roomId === room.id)?.id ?? null;
  stage.classList.add('has-photo');
  stage.style.backgroundImage = `url("${room.canvas.toDataURL('image/jpeg', .9)}")`;
  stage.querySelector('.stage-placeholder')?.remove();
  renderPalette(room);
  renderRooms();
  renderProducts();
  renderStage();
  updateMatch();
  renderSuggestions();
}

$('activeRoomSelect').addEventListener('change', () => {
  const roomId = Number($('activeRoomSelect').value);
  if (roomId) selectRoom(roomId);
});

$('removeRoom').addEventListener('click', () => {
  const index = rooms.findIndex(room => room.id === activeRoomId);
  if (index < 0) return;
  rooms.splice(index, 1);
  for (const product of products) if (product.roomId === activeRoomId) { product.roomId = null; product.roomAuto = true; }
  activeRoomId = rooms[Math.max(0, index - 1)]?.id ?? null;
  refreshAutoAssignments();
  if (activeRoomId) selectRoom(activeRoomId);
  else {
    stage.classList.remove('has-photo');
    stage.style.backgroundImage = '';
    stage.innerHTML = '<div class="stage-placeholder"><span>⌂</span><strong>Your room preview will appear here</strong><small>Add a room photo above to begin</small></div>';
    $('roomName').value = '';
    $('roomType').value = '';
    $('roomStatus').textContent = 'Add a room photo to get started.';
    $('suggestRoom').disabled = true;
    renderPalette(null); renderRooms(); renderStage(); updateMatch(); renderSuggestions();
  }
});

async function getClassifier() {
  if (!classifierPromise) {
    const attempt = import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1').then(({ pipeline, env, RawImage }) => {
      env.allowLocalModels = false;
      // Avoid WASM worker initialization requirements in browsers without cross-origin isolation.
      env.backends.onnx.wasm.numThreads = 1;
      return Promise.all([
        pipeline('zero-shot-image-classification', 'Xenova/clip-vit-base-patch32', {
          device: 'wasm', dtype: 'q8', progress_callback: updateModelProgress,
        }),
        RawImage,
      ]);
    });
    classifierPromise = attempt;
    attempt.catch(() => { if (classifierPromise === attempt) classifierPromise = null; });
  }
  return classifierPromise;
}

function updateModelProgress(info) {
  if (!activeModelStatus) return;
  if (info.status === 'progress_total' && Number.isFinite(info.progress)) {
    activeModelStatus.textContent = `Downloading image model: ${Math.round(info.progress)}% (${formatBytes(info.loaded)} of ${formatBytes(info.total)}). First use can take a few minutes.`;
  } else if (info.status === 'download') {
    activeModelStatus.textContent = `Downloading ${info.file || 'image model'}…`;
  } else if (info.status === 'ready') {
    activeModelStatus.textContent = 'Image model ready. Analyzing the photo…';
  }
}

function formatBytes(bytes = 0) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function withInferenceTimeout(promise, milliseconds = 90000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Image analysis took longer than 90 seconds.')), milliseconds);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function classifyImage(canvas, labels) {
  const task = classifierQueue.then(async () => {
    const [classifier, RawImage] = await getClassifier();
    return classifier(await RawImage.fromCanvas(canvas), labels);
  });
  const timedTask = withInferenceTimeout(task);
  classifierQueue = timedTask.catch(() => {});
  return timedTask;
}

function inferenceErrorText(error) {
  const detail = error?.message || String(error);
  if (/longer than 90 seconds/i.test(detail)) {
    return 'Automatic recognition timed out after 90 seconds. The photo is still available; set the item use and room manually, or reload and try again.';
  }
  if (/aborted|wasm|runtimeerror/i.test(detail)) {
    return 'The browser image runtime stopped unexpectedly. Reload the page and retry; you can still choose the room type or item use manually.';
  }
  return `Image model failed: ${detail}. You can still choose manually.`;
}

$('suggestRoom').addEventListener('click', async () => {
  const room = activeRoom();
  if (!room) return;
  activeModelStatus = $('roomStatus');
  setAnalysisBusy($('suggestRoom'), $('roomStatus'), true, 'Loading model…');
  $('roomStatus').textContent = 'Loading the room recognition model. The first download may take a minute…';
  try {
    $('suggestRoom').textContent = 'Analyzing room…';
    $('roomStatus').textContent = 'Model ready. Analyzing the room photo…';
    const labels = ['a living room', 'a bedroom', 'a kitchen', 'a bathroom', 'a dining room', 'a home office', 'an entryway'];
    const results = await classifyImage(room.canvas, labels);
    const best = results[0];
    const label = best.label.replace(/^a |^an /, '').replace(/^./, character => character.toUpperCase());
    room.type = label;
    $('roomType').value = label;
    $('roomStatus').textContent = `Suggested: ${label} (${Math.round(best.score * 100)}% relative model score). Check the suggestion; similar room types can be confusing.`;
    refreshAutoAssignments(); renderRooms(); renderStage(); renderProducts(); renderSuggestions(); updateMatch();
  } catch (error) {
    if (!/longer than 90 seconds/i.test(error?.message || '')) classifierPromise = null;
    $('roomStatus').textContent = `Room suggestion unavailable. ${inferenceErrorText(error)} Set the room type manually, then continue.`;
  } finally {
    activeModelStatus = null;
    setAnalysisBusy($('suggestRoom'), $('roomStatus'), false);
    $('suggestRoom').disabled = !activeRoom();
  }
});

function yieldToBrowser() { return new Promise(resolve => setTimeout(resolve, 0)); }

async function makeCutout(canvas, sensitivity, onProgress = () => {}) {
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const image = ctx.getImageData(0, 0, w, h);
  const data = image.data;
  const samples = [];
  const stride = Math.max(1, Math.floor(Math.min(w, h) / 35));
  for (let x = 0; x < w; x += stride) for (const y of [0, h - 1]) { const i = (y * w + x) * 4; samples.push([data[i], data[i + 1], data[i + 2]]); }
  for (let y = stride; y < h - stride; y += stride) for (const x of [0, w - 1]) { const i = (y * w + x) * 4; samples.push([data[i], data[i + 1], data[i + 2]]); }
  const bg = [0, 1, 2].map(c => samples.reduce((sum, sample) => sum + sample[c], 0) / Math.max(1, samples.length));
  const limit = 25 + Number(sensitivity) * 1.5;
  const seen = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0, tail = 0;
  const push = index => { if (!seen[index]) { seen[index] = 1; queue[tail++] = index; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 1; y < h - 1; y++) { push(y * w); push(y * w + w - 1); }
  while (head < tail) {
    const p = queue[head++], i = p * 4;
    const dr = data[i] - bg[0], dg = data[i + 1] - bg[1], db = data[i + 2] - bg[2];
    if (Math.sqrt(dr * dr + dg * dg + db * db) > limit) continue;
    data[i + 3] = 0;
    const x = p % w, y = (p / w) | 0;
    if (x > 0) push(p - 1); if (x + 1 < w) push(p + 1); if (y > 0) push(p - w); if (y + 1 < h) push(p + w);
    if (head % 20000 === 0) {
      onProgress(Math.min(99, Math.round(head / (w * h) * 100)));
      await yieldToBrowser();
    }
  }
  ctx.putImageData(image, 0, 0);
}

async function foregroundBounds(canvas, onProgress = () => {}) {
  const { data } = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
  let minX = canvas.width, minY = canvas.height, maxX = -1, maxY = -1;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (data[(y * canvas.width + x) * 4 + 3] < 32) continue;
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
    if (y > 0 && y % 48 === 0) {
      onProgress(Math.round(y / canvas.height * 100));
      await yieldToBrowser();
    }
  }
  return maxX < 0 ? null : { width: maxX - minX + 1, height: maxY - minY + 1 };
}

productInput.addEventListener('change', async () => {
  const file = productInput.files?.[0];
  pendingProduct = null;
  $('addProduct').disabled = true;
  if (!file) return;
  if (!['image/jpeg', 'image/png'].includes(file.type)) { $('productStatus').textContent = 'Choose a JPG or PNG item photo.'; return; }
  $('productStatus').textContent = 'Preparing item photo…';
  try {
    pendingProduct = await imageFromFile(file, 720);
    $('addProduct').disabled = false;
    $('productStatus').textContent = 'Ready. Add this find to create a cutout and compare it in your rooms.';
  } catch (error) { $('productStatus').textContent = error.message; }
});

$('threshold').addEventListener('input', () => { $('sensitivityValue').textContent = $('threshold').value; });
$('removeBackground').addEventListener('change', () => {
  $('threshold').disabled = !$('removeBackground').checked;
  $('productStatus').textContent = $('removeBackground').checked
    ? 'Background removal is on. Plain, contrasting backgrounds give cleaner cutouts.'
    : 'Background removal is off. The complete uploaded photo will be kept in the room preview.';
});
$('addProduct').addEventListener('click', async () => {
  if (!pendingProduct) return;
  setAnalysisBusy($('addProduct'), $('productStatus'), true, 'Preparing photo…');
  const original = pendingProduct;
  const removeBg = $('removeBackground').checked;
  let canvas, bounds, palette;
  try {
    $('productStatus').textContent = 'Preparing item photo…';
    await yieldToBrowser();
    canvas = document.createElement('canvas');
    canvas.width = original.width; canvas.height = original.height;
    canvas.getContext('2d').drawImage(original, 0, 0);
    if (removeBg) await makeCutout(canvas, $('threshold').value, progress => {
      $('productStatus').textContent = `Removing photo background… ${progress}%`;
    });
    $('productStatus').textContent = 'Finding item outline…';
    bounds = await foregroundBounds(canvas, progress => {
      $('productStatus').textContent = `Finding item outline… ${progress}%`;
    });
    $('productStatus').textContent = 'Sampling item colors…';
    await yieldToBrowser();
    palette = await findPalette(canvas, progress => {
      $('productStatus').textContent = `Sampling item colors… ${progress}%`;
    });
  } catch (error) {
    activeModelStatus = null;
    $('productStatus').textContent = `Could not prepare this photo: ${error.message}`;
    setAnalysisBusy($('addProduct'), $('productStatus'), false);
    $('addProduct').disabled = !pendingProduct;
    return;
  }
  if (!palette.length || !bounds) { $('productStatus').textContent = 'No item pixels remained. Lower cutout sensitivity or use a photo with a clearer background.'; setAnalysisBusy($('addProduct'), $('productStatus'), false); $('addProduct').disabled = !pendingProduct; return; }
  $('productStatus').textContent = 'Colors sampled. Building item preview…';
  await yieldToBrowser();
  let product;
  let name;
  try {
    const knownWidth = Number($('knownWidth').value) || null;
    const enteredName = $('productName').value.trim();
    name = enteredName || `Item ${products.length + 1}`;
    product = { id: nextProductId++, name, nameWasCustom: Boolean(enteredName), src: canvas.toDataURL('image/png'), rawCanvas: original, palette, bounds, knownWidth, itemType: null, userCategory: 'auto', roomId: null, roomAuto: true, backgroundRemoved: removeBg, placements: {} };
    products.push(product); selectedId = product.id; $('itemUse').value = 'auto'; pendingProduct = null; productInput.value = ''; $('knownWidth').value = ''; $('productName').value = '';
    renderProducts(); renderStage(); updateMatch(); renderSuggestions(); renderMeasurement();
  } catch (error) {
    activeModelStatus = null;
    $('productStatus').textContent = `Colors sampled, but the item preview could not be created: ${error.message}`;
    setAnalysisBusy($('addProduct'), $('productStatus'), false);
    $('addProduct').disabled = !pendingProduct;
    return;
  }
  activeModelStatus = $('productStatus');
  $('addProduct').textContent = 'Loading model…';
  $('productStatus').textContent = 'Photo ready. Identifying the item and finding its best room…';
  try {
    const results = await classifyImage(original, itemLabels);
    product.itemType = results[0].label;
    product.itemScore = results[0].score;
    if (!product.nameWasCustom) product.name = uniqueDetectedName(product.itemType, product.id);
    refreshAutoAssignments();
    if (product.roomId) selectRoom(product.roomId, product.id);
    renderRooms(); renderStage(); renderProducts(); updateMatch();
    $('productStatus').textContent = `${product.name} identified and added${product.roomId ? ` to ${rooms.find(room => room.id === product.roomId)?.name}` : ''}. You can edit its name below.`;
  } catch (error) {
    if (!/longer than 90 seconds/i.test(error?.message || '')) classifierPromise = null;
    product.roomId = activeRoom()?.id ?? null;
    $('productStatus').textContent = `${product.name} photo is ready, but recognition did not finish. ${inferenceErrorText(error)} Choose the item use and room manually below.`;
    renderProducts(); renderStage(); updateMatch();
  }
  activeModelStatus = null;
  setAnalysisBusy($('addProduct'), $('productStatus'), false);
  $('addProduct').disabled = !pendingProduct;
  renderSuggestions();
});

function renderProducts() {
  const holder = $('products');
  $('deleteFind').hidden = !activeProduct();
  $('selectedProductName').disabled = !activeProduct();
  $('selectedProductName').value = activeProduct()?.name || '';
  if (!products.length) { holder.innerHTML = '<p class="empty-state">Your saved finds will appear here.</p>'; fillProductRoomSelect(); return; }
  holder.innerHTML = products.map(product => {
    const roomName = rooms.find(room => room.id === product.roomId)?.name || 'Choose a room';
    return `<button class="product-chip ${product.id === selectedId ? 'active' : ''}" data-id="${product.id}" type="button"><img src="${product.src}" alt=""><span>${escapeHtml(product.name)}<br><small>${escapeHtml(roomName)}</small></span><i style="background:${product.palette[0] || '#ddd'}"></i></button>`;
  }).join('');
  holder.querySelectorAll('.product-chip').forEach(button => button.addEventListener('click', () => {
    selectedId = Number(button.dataset.id);
    const product = activeProduct();
    if (product?.roomId && product.roomId !== activeRoomId) { selectRoom(product.roomId, product.id); return; }
    renderProducts(); renderStage(); updateMatch(); renderSuggestions(); renderMeasurement();
  }));
  fillProductRoomSelect();
}

$('selectedProductName').addEventListener('change', () => {
  const product = activeProduct();
  if (!product) return;
  product.name = $('selectedProductName').value.trim() || 'Item';
  product.nameWasCustom = true;
  renderProducts();
  renderStage();
  renderSuggestions();
  updateMatch();
});

function placementFor(product, room) {
  if (!product.placements[room.id]) product.placements[room.id] = { x: 42 + (product.id % 4) * 5, y: 42 + (product.id % 3) * 5, scale: 38 };
  return product.placements[room.id];
}

function renderStage() {
  stage.querySelectorAll('.stage-item').forEach(item => item.remove());
  const room = activeRoom();
  if (!room) { $('placementControls').hidden = true; syncSelection(); return; }
  const visibleProducts = products.filter(product => product.roomId === room.id);
  if (!activeProduct() && visibleProducts.length) selectedId = visibleProducts[0].id;
  $('placementControls').hidden = !visibleProducts.length && !activeProduct();
  for (const product of visibleProducts) {
    const place = placementFor(product, room);
    const image = document.createElement('img');
    image.src = product.src; image.alt = product.name; image.dataset.id = product.id; image.className = 'stage-item'; image.draggable = false;
    image.style.left = `${place.x}%`; image.style.top = `${place.y}%`; image.style.width = `${place.scale}%`;
    if (product.id === selectedId) image.style.outline = '1px dashed #fff';
    makeDraggable(image, product, room);
    image.addEventListener('pointerdown', () => { selectedId = product.id; syncSelection(); renderProducts(); renderSuggestions(); renderMeasurement(); });
    stage.appendChild(image);
  }
  syncSelection();
}

function makeDraggable(image, product, room) {
  let origin;
  image.addEventListener('pointerdown', event => {
    event.preventDefault(); image.setPointerCapture(event.pointerId);
    const place = placementFor(product, room); const box = stage.getBoundingClientRect();
    origin = { x: event.clientX, y: event.clientY, px: place.x, py: place.y, w: box.width, h: box.height };
  });
  image.addEventListener('pointermove', event => {
    if (!origin) return;
    const place = placementFor(product, room);
    place.x = Math.max(0, Math.min(100, origin.px + (event.clientX - origin.x) / origin.w * 100));
    place.y = Math.max(0, Math.min(100, origin.py + (event.clientY - origin.y) / origin.h * 100));
    image.style.left = `${place.x}%`; image.style.top = `${place.y}%`;
  });
  const stop = () => { origin = null; };
  image.addEventListener('pointerup', stop); image.addEventListener('pointercancel', stop);
}

function syncSelection() {
  const select = $('selectedProduct');
  const room = activeRoom();
  const visibleProducts = room ? products.filter(item => item.roomId === room.id) : [];
  select.innerHTML = visibleProducts.map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('');
  select.disabled = !visibleProducts.length;
  const stageProduct = visibleProducts.find(item => item.id === selectedId) || visibleProducts[0] || null;
  if (stageProduct) select.value = String(stageProduct.id);
  const product = activeProduct();
  if (product) $('itemUse').value = product.userCategory || 'auto';
  $('productRoom').disabled = !product || !rooms.length;
  $('productRoom').value = product?.roomId ? String(product.roomId) : '';
  $('itemScale').disabled = !stageProduct || !room;
  if (stageProduct && room) $('itemScale').value = placementFor(stageProduct, room).scale;
}

$('selectedProduct').addEventListener('change', () => {
  selectedId = Number($('selectedProduct').value); renderProducts(); renderStage(); updateMatch(); renderSuggestions(); renderMeasurement();
});
$('itemScale').addEventListener('input', () => {
  const product = activeProduct(), room = activeRoom();
  if (!product || !room) return;
  placementFor(product, room).scale = Number($('itemScale').value);
  const image = stage.querySelector(`.stage-item[data-id="${product.id}"]`);
  if (image) image.style.width = `${product.placements[room.id].scale}%`;
});
$('removeProduct').addEventListener('click', () => {
  const index = products.findIndex(product => product.id === selectedId);
  if (index < 0) return;
  products.splice(index, 1); selectedId = products[Math.max(0, index - 1)]?.id ?? null;
  renderProducts(); renderStage(); updateMatch(); renderSuggestions(); renderMeasurement();
});
$('deleteFind').addEventListener('click', () => $('removeProduct').click());

function renderSuggestions() {
  const product = activeProduct();
  const holder = $('itemSuggestion');
  if (!product) {
    $('typicalRoomValue').textContent = 'Upload an item photo';
    $('typicalRoomReason').textContent = 'Computer vision will identify the item and suggest its usual room separately from color matching.';
    holder.textContent = 'Add an item to see room suggestions.';
    return;
  }
  const likelyRoom = product.userCategory === 'flexible' ? null : (product.userCategory !== 'auto' ? product.userCategory : roomForItemType(product.itemType));
  const hasTypicalRoom = likelyRoom && rooms.some(room => roomMatchesType(room, likelyRoom));
  $('typicalRoomValue').textContent = product.userCategory === 'flexible'
    ? 'Flexible decor - choose by room'
    : likelyRoom || (product.itemType ? 'Color fit decides the room' : 'Analyzing item photo…');
  $('typicalRoomReason').textContent = product.userCategory === 'flexible'
    ? 'This item is treated as decor. Its likely room is chosen from the color profile, not from a fixed use.'
    : product.userCategory !== 'auto'
      ? 'You selected this use. The room suggestion is based on the item category and does not depend on its colors.'
      : product.itemType
        ? `Image model identified: ${displayItemType(product.itemType)}${Number.isFinite(product.itemScore) ? ` (${Math.round(product.itemScore * 100)}% relative score).` : '.'} ${likelyRoom ? `Its usual use points to ${likelyRoom}, regardless of color.` : 'This looks like flexible decor, so color affinity helps rank your rooms.'}`
        : 'The item classifier is loading or unavailable. You can still choose an item use above.';
  const ranked = rooms.map(room => ({ room, score: colorAffinity(product.palette, updatedRoomPalette(room, product.id)) })).sort((a, b) => b.score - a.score);
  if (!rooms.length) {
    holder.textContent = likelyRoom ? `Typical room: ${likelyRoom}. Add room photos to compare colors and place this item.` : 'Add room photos to compare colors and choose where this item belongs.';
    return;
  }
  holder.innerHTML = `<div class="suggestion-row"><b>Color affinity by room</b><span>base photo + other placed items</span></div>${ranked.map((entry, index) => `<div class="suggestion-row"><b>${index === 0 ? 'Closest colors · ' : ''}${escapeHtml(entry.room.name)}</b><span>${entry.score}/100 · ${escapeHtml(entry.room.type || 'type not set')}</span></div>`).join('')}<div class="suggestion-caveat">${likelyRoom ? `Typical room category: ${escapeHtml(likelyRoom)}. ${hasTypicalRoom ? '' : `No ${escapeHtml(likelyRoom.toLowerCase())} is saved; the item stays unplaced until one is added or you choose a room manually. `}` : ''}Color comparison uses the room's base photo and placed items; the selected item is excluded from its own score. This is a visual cue, not a style score.</div>`;
}

function roomForItemType(type = '') {
  const value = String(type || '').toLowerCase();
  if (/toaster|kettle|microwave|cookware|coffee maker|blender|dish|cutlery|pan|pot/.test(value)) return 'Kitchen';
  if (/sofa|couch|armchair|rug|floor lamp|coffee table|side table|television|tv stand/.test(value)) return 'Living room';
  if (/bedside lamp|\bbed\b|mattress|duvet|pillow|wardrobe/.test(value)) return 'Bedroom';
  if (/dining table|dining chair|dining set/.test(value)) return 'Dining room';
  if (/desk|office chair|bookshelf|monitor/.test(value)) return 'Home office';
  if (/bathroom|towel|shower|bath mat/.test(value)) return 'Bathroom';
  return null;
}

function displayItemType(type = '') {
  return String(type || 'Unknown item').replace(/^(a|an)\s+/i, '').replace(/^./, character => character.toUpperCase());
}

function uniqueDetectedName(type, productId) {
  const base = displayItemType(type);
  const duplicateCount = products.filter(product => product.id !== productId && product.itemType
    && displayItemType(product.itemType).toLowerCase() === base.toLowerCase()).length;
  return duplicateCount ? `${base} ${duplicateCount + 1}` : base;
}

function roomMatchesType(room, type) {
  const normalized = String(type || '').trim().toLowerCase();
  if (!normalized) return false;
  return String(room?.type || '').trim().toLowerCase() === normalized
    || String(room?.name || '').trim().toLowerCase().includes(normalized);
}

function recommendedRoomId(product) {
  if (!rooms.length) return null;
  const type = product.userCategory === 'flexible'
    ? null
    : product.userCategory !== 'auto' ? product.userCategory : roomForItemType(product.itemType || '');
  if (type) {
    const normalized = String(type).trim().toLowerCase();
    const room = rooms.find(entry => String(entry.type || '').trim().toLowerCase() === normalized)
      || rooms.find(entry => roomMatchesType(entry, type));
    return room?.id ?? null;
  }
  return rooms.map(room => ({ room, score: colorAffinity(product.palette, updatedRoomPalette(room, product.id)) }))
    .sort((a, b) => b.score - a.score)[0]?.room.id ?? null;
}

function refreshAutoAssignments() {
  for (const product of products) if (product.roomAuto) product.roomId = recommendedRoomId(product);
}

$('itemUse').addEventListener('change', () => {
  const product = activeProduct();
  if (!product) return;
  product.userCategory = $('itemUse').value;
  refreshAutoAssignments();
  if (product.roomAuto && product.roomId && product.roomId !== activeRoomId) { selectRoom(product.roomId); return; }
  renderStage(); renderProducts(); renderSuggestions(); updateMatch();
});

$('productRoom').addEventListener('change', () => {
  const product = activeProduct();
  if (!product) return;
  product.roomId = Number($('productRoom').value) || null;
  product.roomAuto = false;
  if (product.roomId) selectRoom(product.roomId, product.id);
  else { renderStage(); renderProducts(); renderSuggestions(); updateMatch(); }
});

function renderMeasurement() {
  const product = activeProduct(), box = $('measurementNote');
  if (!product) { box.hidden = true; return; }
  box.hidden = false;
  const ratio = product.bounds.height / product.bounds.width;
  const estimate = product.knownWidth ? `Using the width you entered (${product.knownWidth} cm), the silhouette aspect ratio estimates an image height of about ${(product.knownWidth * ratio).toFixed(1)} cm.` : `Foreground silhouette: ${product.bounds.width} × ${product.bounds.height} px (height-to-width ratio ${ratio.toFixed(2)}). Enter a known width above before adding another item to get an approximate image-height estimate.`;
  box.textContent = `${estimate} This is a 2D front-view estimate; it does not measure depth and can be wrong with perspective, angled photos, or an imperfect cutout.`;
}

function updateMatch() {
  const product = activeProduct();
  renderPalette(activeRoom());
  const assignedRoom = rooms.find(room => room.id === product?.roomId);
  const comparisonPalette = assignedRoom ? updatedRoomPalette(assignedRoom, product?.id) : [];
  $('itemColorSwatches').innerHTML = product?.palette.map(color => `<i title="${color}" style="background:${color}"></i>`).join('') || '';
  $('roomColorSwatches').innerHTML = comparisonPalette.map(color => `<i title="${color}" style="background:${color}"></i>`).join('');
  const ranked = product ? rooms.map(room => ({ room, score: colorAffinity(product.palette, updatedRoomPalette(room, product.id)) })).sort((a, b) => b.score - a.score) : [];
  const affinity = product && assignedRoom ? colorAffinity(product.palette, comparisonPalette) : 0;
  $('affinityFill').style.width = `${affinity}%`;
  $('colorAnalysisText').textContent = !product
    ? 'Add an item to compare its sampled color profile with your saved rooms.'
    : assignedRoom
      ? `${product.name} and ${assignedRoom.name}'s room profile have a rough color affinity of ${affinity}/100. It combines the base room photo with other items placed there, excluding ${product.name}. The ranking below compares the item with every saved room.${product.backgroundRemoved ? '' : ' Background removal is off, so the item sample includes the full photo background.'}`
      : 'Choose a room for this item to compare the two color profiles.';
  $('roomColorScores').innerHTML = ranked.map(({ room, score }) => `<div class="color-score"><span>${escapeHtml(room.name)}${room.id === product?.roomId ? ' · assigned' : ''}</span><div><i style="width:${score}%"></i></div><b>${score}</b></div>`).join('');
}

function escapeHtml(value) { return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]); }

renderRooms();
renderProducts();




