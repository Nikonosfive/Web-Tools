'use strict';

(() => {
  const MAX_FILES = 100;
  const MAX_PREVIEW_EDGE = 1100;
  const MAX_FOCUS_EDGE = 768;
  const ALIGNMENT_EDGE = 560;
  const MAX_FEATURES = 560;
  const $ = (id) => document.getElementById(id);

  const ui = {
    fileInput: $('fileInput'), dropzone: $('dropzone'), imageList: $('imageList'), imageCount: $('imageCount'),
    clearAllBtn: $('clearAllBtn'), referenceSelect: $('referenceSelect'), alignToggle: $('alignToggle'), cropToggle: $('cropToggle'),
    featherSelect: $('featherSelect'), tileSize: $('tileSize'), outputFormat: $('outputFormat'), jpegQuality: $('jpegQuality'),
    qualityValue: $('qualityValue'), jpegQualityBlock: $('jpegQualityBlock'), estimateTitle: $('estimateTitle'), estimateText: $('estimateText'),
    startBtn: $('startBtn'), cancelBtn: $('cancelBtn'), progressPanel: $('progressPanel'), progressTitle: $('progressTitle'),
    progressPercent: $('progressPercent'), progressBar: $('progressBar'), progressMessage: $('progressMessage'), progressSubMessage: $('progressSubMessage'),
    progressLog: $('progressLog'), resultPanel: $('resultPanel'), resultImage: $('resultImage'), resultMeta: $('resultMeta'),
    downloadLink: $('downloadLink'), resultFootText: $('resultFootText'), runAgainBtn: $('runAgainBtn'), toast: $('toast')
  };

  let items = [];
  let nextId = 1;
  let busy = false;
  let adding = false;
  let cancelRequested = false;
  let toastTimer = null;
  let resultUrl = null;
  let resultBlob = null;
  let lastResultObjectUrl = null;

  class CancelledError extends Error {
    constructor() { super('処理がキャンセルされました'); this.name = 'CancelledError'; }
  }

  function checkCancelled() {
    if (cancelRequested) throw new CancelledError();
  }

  function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function showToast(message, isError = false) {
    ui.toast.textContent = message;
    ui.toast.classList.toggle('error', isError);
    ui.toast.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 3600);
  }

  function setProgress(percent, title, message, subMessage = '') {
    const v = Math.max(0, Math.min(100, Math.round(percent)));
    ui.progressPanel.hidden = false;
    ui.progressPercent.textContent = `${v}%`;
    ui.progressBar.style.width = `${v}%`;
    if (title !== undefined) ui.progressTitle.textContent = title;
    if (message !== undefined) ui.progressMessage.textContent = message;
    if (subMessage !== undefined) ui.progressSubMessage.textContent = subMessage;
  }

  function addProgressChip(label, state = 'done') {
    const chip = document.createElement('span');
    chip.className = `progress-chip ${state}`;
    chip.textContent = label;
    ui.progressLog.appendChild(chip);
  }

  function clearProgress() {
    ui.progressLog.replaceChildren();
    ui.progressPanel.hidden = true;
    ui.progressBar.style.width = '0%';
  }

  function setBusy(value) {
    busy = value;
    ui.fileInput.disabled = value;
    ui.dropzone.style.pointerEvents = value ? 'none' : '';
    ui.startBtn.disabled = value || items.length < 2 || adding;
    ui.clearAllBtn.disabled = value || items.length === 0;
    ui.referenceSelect.disabled = value || items.length < 2;
    ui.alignToggle.disabled = value;
    ui.cropToggle.disabled = value;
    ui.featherSelect.disabled = value;
    ui.tileSize.disabled = value;
    ui.outputFormat.disabled = value;
    ui.jpegQuality.disabled = value;
    ui.cancelBtn.hidden = !value;
    ui.cancelBtn.disabled = false;
    ui.cancelBtn.textContent = '処理をキャンセル';
    if (value) ui.startBtn.innerHTML = '<span class="button-spark">✳</span><span>合成処理中…</span><span class="button-arrow">⋯</span>';
    else ui.startBtn.innerHTML = '<span class="button-spark">✳</span><span>深度合成を開始</span><span class="button-arrow">→</span>';
    updateEstimate();
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatNumber(n) {
    return Math.round(n).toLocaleString('ja-JP');
  }

  function updateEstimate() {
    ui.imageCount.textContent = String(items.length);
    ui.clearAllBtn.disabled = busy || items.length === 0;
    ui.startBtn.disabled = busy || adding || items.length < 2;
    ui.referenceSelect.disabled = busy || items.length < 2;
    ui.estimateTitle.textContent = items.length < 2 ? '処理の準備ができていません' : `${items.length}枚を合成できます`;
    if (items.length < 2) {
      ui.estimateText.textContent = '画像を2枚以上追加すると、出力サイズの目安を表示します。';
    } else {
      const ref = items.find((it) => it.id === Number(ui.referenceSelect.value)) || items[0];
      const pixels = ref.width * ref.height;
      const megapixels = pixels / 1e6;
      const approximate = (pixels * (ui.outputFormat.value === 'png' ? 0.9 : 0.32)) / (1024 * 1024);
      const sizeText = `${formatNumber(ref.width)} × ${formatNumber(ref.height)} px · ${megapixels.toFixed(1)} MP`;
      const fileText = `出力サイズの目安 ${Math.max(1, Math.round(approximate))} MB（画像内容により変動）`;
      ui.estimateText.textContent = `${sizeText}。${fileText}。`;
    }
  }

  function refreshReferenceOptions() {
    const previous = Number(ui.referenceSelect.value);
    ui.referenceSelect.replaceChildren();
    items.forEach((item, index) => {
      const option = document.createElement('option');
      option.value = String(item.id);
      option.textContent = `${String(index + 1).padStart(2, '0')} · ${item.file.name}`;
      ui.referenceSelect.appendChild(option);
    });
    if (!items.some((it) => it.id === previous)) {
      if (items.length) ui.referenceSelect.value = String(items[0].id);
    } else {
      ui.referenceSelect.value = String(previous);
    }
    if (!items.length) {
      const option = document.createElement('option');
      option.textContent = '画像を追加してください';
      ui.referenceSelect.appendChild(option);
    }
  }

  function renderList() {
    ui.imageList.replaceChildren();
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-list';
      const icon = document.createElement('span');
      icon.className = 'empty-icon';
      icon.textContent = '▧';
      const p = document.createElement('p');
      p.textContent = 'まだ画像がありません';
      const small = document.createElement('small');
      small.textContent = 'フォーカスブラケット撮影した画像を追加してください';
      empty.append(icon, p, small);
      ui.imageList.appendChild(empty);
    } else {
      const refId = Number(ui.referenceSelect.value) || items[0].id;
      items.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = `image-row${item.id === refId ? ' is-reference' : ''}`;
        row.dataset.id = String(item.id);
        const thumb = document.createElement('img');
        thumb.className = 'image-thumb';
        thumb.alt = '';
        thumb.loading = 'lazy';
        thumb.src = item.thumbUrl;
        const main = document.createElement('div');
        main.className = 'image-row-main';
        const name = document.createElement('span');
        name.className = 'image-name';
        name.title = item.file.name;
        name.textContent = item.file.name;
        const subline = document.createElement('div');
        subline.className = 'image-subline';
        const dimensions = document.createElement('span');
        dimensions.className = 'image-dimensions';
        dimensions.textContent = `${item.width.toLocaleString()} × ${item.height.toLocaleString()} · ${formatBytes(item.file.size)}`;
        subline.appendChild(dimensions);
        if (item.id === refId) {
          const badge = document.createElement('span');
          badge.className = 'reference-tag';
          badge.textContent = 'REFERENCE';
          subline.appendChild(badge);
        }
        if (item.registrationStatus && item.registrationStatus.startsWith('fallback')) {
          const badge = document.createElement('span');
          badge.className = 'alignment-tag warn';
          badge.textContent = 'ALIGN CHECK';
          badge.title = item.registrationMessage || '自動位置合わせが信頼できませんでした';
          subline.appendChild(badge);
        }
        main.append(name, subline);
        const actions = document.createElement('div');
        actions.className = 'row-actions';
        const up = document.createElement('button');
        up.className = 'icon-button'; up.type = 'button'; up.title = '上へ'; up.setAttribute('aria-label', `${item.file.name}を上へ`); up.textContent = '↑';
        up.disabled = busy || index === 0;
        up.addEventListener('click', () => moveItem(item.id, -1));
        const down = document.createElement('button');
        down.className = 'icon-button'; down.type = 'button'; down.title = '下へ'; down.setAttribute('aria-label', `${item.file.name}を下へ`); down.textContent = '↓';
        down.disabled = busy || index === items.length - 1;
        down.addEventListener('click', () => moveItem(item.id, 1));
        const remove = document.createElement('button');
        remove.className = 'icon-button remove'; remove.type = 'button'; remove.title = '削除'; remove.setAttribute('aria-label', `${item.file.name}を削除`); remove.textContent = '×';
        remove.disabled = busy;
        remove.addEventListener('click', () => removeItem(item.id));
        actions.append(up, down, remove);
        row.append(thumb, main, actions);
        ui.imageList.appendChild(row);
      });
    }
    refreshReferenceOptions();
    updateEstimate();
  }

  function revokeItemUrls(item) {
    if (item.thumbUrl) URL.revokeObjectURL(item.thumbUrl);
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  }

  function moveItem(id, delta) {
    if (busy) return;
    const index = items.findIndex((it) => it.id === id);
    const to = index + delta;
    if (index < 0 || to < 0 || to >= items.length) return;
    [items[index], items[to]] = [items[to], items[index]];
    renderList();
  }

  function removeItem(id) {
    if (busy) return;
    const index = items.findIndex((it) => it.id === id);
    if (index < 0) return;
    revokeItemUrls(items[index]);
    items.splice(index, 1);
    renderList();
    showToast('画像を一覧から削除しました');
  }

  function clearAll() {
    if (busy) return;
    items.forEach(revokeItemUrls);
    items = [];
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    if (lastResultObjectUrl) URL.revokeObjectURL(lastResultObjectUrl);
    resultUrl = null; resultBlob = null; lastResultObjectUrl = null;
    ui.downloadLink.removeAttribute('href');
    ui.resultPanel.hidden = true;
    renderList();
    showToast('画像一覧をクリアしました');
  }

  function readU16BE(view, offset) { return view.getUint16(offset, false); }
  function readU32BE(view, offset) { return view.getUint32(offset, false); }
  function readU16LE(view, offset) { return view.getUint16(offset, true); }
  function readU32LE(view, offset) { return view.getUint32(offset, true); }

  function parseExifOrientation(bytes, start, length) {
    if (length < 14 || bytes[start] !== 0x45 || bytes[start + 1] !== 0x78 || bytes[start + 2] !== 0x69 || bytes[start + 3] !== 0x66) return 1;
    if (bytes[start + 4] !== 0 || bytes[start + 5] !== 0) return 1;
    const tiff = start + 6;
    const byteOrder = String.fromCharCode(bytes[tiff], bytes[tiff + 1]);
    const little = byteOrder === 'II';
    if (!little && byteOrder !== 'MM') return 1;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u16 = (off) => view.getUint16(off, little);
    const u32 = (off) => view.getUint32(off, little);
    if (u16(tiff + 2) !== 42) return 1;
    const ifd = tiff + u32(tiff + 4);
    if (ifd + 2 > start + length) return 1;
    const count = Math.min(u16(ifd), 256);
    for (let i = 0; i < count; i++) {
      const entry = ifd + 2 + i * 12;
      if (entry + 12 > start + length) break;
      if (u16(entry) === 0x0112) {
        const orientation = u16(entry + 8);
        return orientation >= 1 && orientation <= 8 ? orientation : 1;
      }
    }
    return 1;
  }

  async function readImageInfo(file) {
    const head = await file.slice(0, Math.min(file.size, 1024 * 1024)).arrayBuffer();
    const bytes = new Uint8Array(head);
    const view = new DataView(head);
    let width = 0, height = 0, orientation = 1;

    // JPEG dimensions and EXIF orientation.
    if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
      let p = 2;
      while (p + 4 < bytes.length) {
        if (bytes[p] !== 0xff) { p++; continue; }
        while (p < bytes.length && bytes[p] === 0xff) p++;
        if (p >= bytes.length) break;
        const marker = bytes[p++];
        if (marker === 0xd9 || marker === 0xda) break;
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
        if (p + 2 > bytes.length) break;
        const segmentLength = readU16BE(view, p);
        if (segmentLength < 2 || p + segmentLength > bytes.length) break;
        const payload = p + 2;
        const payloadLength = segmentLength - 2;
        if (marker === 0xe1) orientation = parseExifOrientation(bytes, payload, payloadLength);
        const isSof = [0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker);
        if (isSof && payloadLength >= 5) {
          height = readU16BE(view, payload + 1);
          width = readU16BE(view, payload + 3);
          break;
        }
        p += segmentLength;
      }
    }
    // PNG.
    if (!width && bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      width = readU32BE(view, 16); height = readU32BE(view, 20);
    }
    // WebP VP8X / VP8 / VP8L.
    if (!width && bytes.length >= 30 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') {
      const chunk = String.fromCharCode(...bytes.slice(12, 16));
      if (chunk === 'VP8X' && bytes.length >= 30) {
        width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
        height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
      } else if (chunk === 'VP8 ' && bytes.length >= 30) {
        width = readU16LE(view, 26) & 0x3fff; height = readU16LE(view, 28) & 0x3fff;
      } else if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
        width = 1 + (((bytes[22] & 0x3f) << 8) | bytes[21]);
        height = 1 + (((bytes[24] & 0x0f) << 10) | (bytes[23] << 2) | ((bytes[22] & 0xc0) >> 6));
      }
    }
    // BMP.
    if (!width && bytes.length >= 26 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
      width = Math.abs(view.getInt32(18, true)); height = Math.abs(view.getInt32(22, true));
    }
    // GIF.
    if (!width && bytes.length >= 10 && String.fromCharCode(...bytes.slice(0, 3)) === 'GIF') {
      width = readU16LE(view, 6); height = readU16LE(view, 8);
    }
    if (!width || !height) {
      // Rare/modern formats: ask the browser decoder for dimensions. Only one bitmap is held here.
      const full = await createImageBitmap(file);
      width = full.width; height = full.height;
      full.close();
      orientation = 1;
    } else if (orientation >= 5 && orientation <= 8) {
      [width, height] = [height, width];
    }
    if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) throw new Error(`画像サイズを取得できません: ${file.name}`);
    return { width, height, orientation };
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      try {
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('画像を書き出せませんでした。画像サイズが大きすぎる可能性があります。')), type, quality);
      } catch (error) { reject(error); }
    });
  }

  function targetPreviewDimensions(width, height) {
    const scale = Math.min(1, MAX_PREVIEW_EDGE / Math.max(width, height));
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
  }

  async function makePreviewBlob(file, width, height) {
    const target = targetPreviewDimensions(width, height);
    const bitmap = await createImageBitmap(file, { resizeWidth: target.width, resizeHeight: target.height, resizeQuality: 'high' });
    const canvas = document.createElement('canvas');
    const actualPreviewWidth = bitmap.width;
    const actualPreviewHeight = bitmap.height;
    canvas.width = actualPreviewWidth; canvas.height = actualPreviewHeight;
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.94);
    const thumbCanvas = document.createElement('canvas');
    const thumbScale = Math.min(1, 180 / Math.max(canvas.width, canvas.height));
    thumbCanvas.width = Math.max(1, Math.round(canvas.width * thumbScale));
    thumbCanvas.height = Math.max(1, Math.round(canvas.height * thumbScale));
    const thumbCtx = thumbCanvas.getContext('2d', { alpha: false });
    thumbCtx.imageSmoothingEnabled = true; thumbCtx.imageSmoothingQuality = 'high';
    thumbCtx.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
    const thumbBlob = await canvasToBlob(thumbCanvas, 'image/jpeg', 0.78);
    canvas.width = canvas.height = thumbCanvas.width = thumbCanvas.height = 1;
    return { previewBlob: blob, previewWidth: actualPreviewWidth, previewHeight: actualPreviewHeight, thumbUrl: URL.createObjectURL(thumbBlob) };
  }

  async function ensurePreview(item) {
    if (item.previewBlob) return;
    const preview = await makePreviewBlob(item.file, item.width, item.height);
    item.previewBlob = preview.previewBlob;
    item.previewWidth = preview.previewWidth;
    item.previewHeight = preview.previewHeight;
    if (!item.thumbUrl) item.thumbUrl = preview.thumbUrl;
    else URL.revokeObjectURL(preview.thumbUrl);
  }

  async function addFiles(fileList) {
    if (busy || adding) return;
    const received = Array.from(fileList || []).filter((file) => file && (file.type.startsWith('image/') || /\.(jpe?g|png|webp|bmp|gif|avif|tiff?)$/i.test(file.name)));
    if (!received.length) { showToast('画像ファイルを選択してください。', true); return; }
    const room = Math.max(0, MAX_FILES - items.length);
    const selected = received.slice(0, room);
    if (!selected.length) { showToast('一度に扱える画像は100枚までです。', true); return; }
    if (selected.length < received.length) showToast(`100枚までのため、${selected.length}枚を追加します。`);
    adding = true;
    ui.fileInput.disabled = true;
    ui.dropzone.style.pointerEvents = 'none';
    ui.estimateTitle.textContent = '画像を読み込んでいます…';
    let addedCount = 0;
    try {
      for (let i = 0; i < selected.length; i++) {
        const file = selected[i];
        if (!file.size) continue;
        try {
          const info = await readImageInfo(file);
          const preview = await makePreviewBlob(file, info.width, info.height);
          items.push({
            id: nextId++, file, width: info.width, height: info.height, orientation: info.orientation,
            previewBlob: preview.previewBlob, previewWidth: preview.previewWidth, previewHeight: preview.previewHeight,
            thumbUrl: preview.thumbUrl, previewUrl: null, matrixPreview: null, matrixFull: null,
            registrationStatus: '', registrationMessage: ''
          });
          addedCount++;
          renderList();
        } catch (error) {
          console.error(error);
          showToast(`${file.name}: 読み込めませんでした`, true);
        }
        ui.estimateText.textContent = `${i + 1} / ${selected.length} 枚のプレビューを作成中…`;
        await nextFrame();
      }
    } finally {
      adding = false;
      ui.fileInput.disabled = false;
      ui.dropzone.style.pointerEvents = '';
      renderList();
    }
    if (addedCount) {
      ui.resultPanel.hidden = true;
      showToast(`${addedCount}枚の画像を追加しました`);
    }
  }

  function matrixApply(m, x, y) {
    return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
  }

  function matrixInvertPoint(m, x, y) {
    const det = m[0] * m[3] - m[1] * m[2];
    if (!Number.isFinite(det) || Math.abs(det) < 1e-10) return { x: -Infinity, y: -Infinity };
    const dx = x - m[4], dy = y - m[5];
    return { x: (m[3] * dx - m[2] * dy) / det, y: (-m[1] * dx + m[0] * dy) / det };
  }

  function makePreviewResizeMatrix(item, reference) {
    return [reference.previewWidth / item.previewWidth, 0, 0, reference.previewHeight / item.previewHeight, 0, 0];
  }

  function previewToFullMatrix(matrix, item, reference) {
    const srcSX = item.previewWidth / item.width;
    const srcSY = item.previewHeight / item.height;
    const refSX = reference.previewWidth / reference.width;
    const refSY = reference.previewHeight / reference.height;
    return [
      matrix[0] * srcSX / refSX,
      matrix[1] * srcSX / refSY,
      matrix[2] * srcSY / refSX,
      matrix[3] * srcSY / refSY,
      matrix[4] / refSX,
      matrix[5] / refSY
    ];
  }

  // Native in-browser image registration: FAST corners + orientation-normalized BRIEF descriptors.
  // This implementation deliberately has no network dependency and processes only small previews.
  const FAST_CIRCLE = [
    [0, -3], [1, -3], [2, -2], [3, -1], [3, 0], [3, 1], [2, 2], [1, 3],
    [0, 3], [-1, 3], [-2, 2], [-3, 1], [-3, 0], [-3, -1], [-2, -2], [-1, -3]
  ];
  const BRIEF_PATTERN = (() => {
    let seed = 0x6d2b79f5;
    const random = () => {
      seed = Math.imul(seed ^ (seed >>> 15), seed | 1);
      seed ^= seed + Math.imul(seed ^ (seed >>> 7), seed | 61);
      return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296;
    };
    const points = [];
    while (points.length < 512) {
      const x = Math.round(random() * 22 - 11);
      const y = Math.round(random() * 22 - 11);
      if (x * x + y * y <= 121) points.push([x, y]);
    }
    return points;
  })();
  const HAMMING_LUT = (() => {
    const table = new Uint8Array(256);
    for (let value = 0; value < 256; value++) {
      let v = value, bits = 0;
      while (v) { bits += v & 1; v >>>= 1; }
      table[value] = bits;
    }
    return table;
  })();

  async function alignmentPixels(item) {
    await ensurePreview(item);
    const bitmap = await createImageBitmap(item.previewBlob);
    const scale = Math.min(1, ALIGNMENT_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: false });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const imageData = ctx.getImageData(0, 0, width, height);
    canvas.width = canvas.height = 1;
    return { imageData, width, height, scaleX: item.previewWidth / width, scaleY: item.previewHeight / height };
  }

  function imageDataToGray(imageData, width, height) {
    const rgba = imageData.data;
    const gray = new Uint8Array(width * height);
    for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
      // Integer approximation of Rec. 709 luma; avoids allocating temporary channel arrays.
      gray[i] = (77 * rgba[p] + 150 * rgba[p + 1] + 29 * rgba[p + 2]) >> 8;
    }
    return gray;
  }

  function fastCandidates(gray, width, height) {
    const scoreMap = new Uint16Array(width * height);
    const threshold = 16;
    for (let y = 16; y < height - 16; y++) {
      const row = y * width;
      for (let x = 16; x < width - 16; x++) {
        const centerIndex = row + x;
        const center = gray[centerIndex];
        let brightCardinals = 0, darkCardinals = 0;
        for (let q = 0; q < 4; q++) {
          const [ox, oy] = FAST_CIRCLE[q * 4];
          const delta = gray[centerIndex + oy * width + ox] - center;
          if (delta > threshold) brightCardinals++;
          else if (delta < -threshold) darkCardinals++;
        }
        if (brightCardinals < 2 && darkCardinals < 2) continue;
        let brightRun = 0, darkRun = 0, isCorner = false;
        for (let k = 0; k < 24; k++) {
          const [ox, oy] = FAST_CIRCLE[k & 15];
          const delta = gray[centerIndex + oy * width + ox] - center;
          brightRun = delta > threshold ? brightRun + 1 : 0;
          darkRun = delta < -threshold ? darkRun + 1 : 0;
          if (brightRun >= 9 || darkRun >= 9) { isCorner = true; break; }
        }
        if (!isCorner) continue;
        let score = 0;
        for (const [ox, oy] of FAST_CIRCLE) score += Math.min(255, Math.abs(gray[centerIndex + oy * width + ox] - center));
        scoreMap[centerIndex] = score;
      }
    }

    const candidates = [];
    for (let y = 17; y < height - 17; y++) {
      const row = y * width;
      for (let x = 17; x < width - 17; x++) {
        const idx = row + x, score = scoreMap[idx];
        if (!score) continue;
        let strongest = true;
        for (let dy = -1; dy <= 1 && strongest; dy++) {
          const neighbourRow = (y + dy) * width;
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            if (scoreMap[neighbourRow + x + dx] > score) { strongest = false; break; }
          }
        }
        if (strongest) candidates.push({ x, y, score });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    // Grid quotas spread points over the frame instead of letting a textured corner dominate.
    const columns = 12, rows = 8, perCell = 6;
    const cellCounts = new Uint8Array(columns * rows);
    const selected = [];
    for (const point of candidates) {
      const cx = Math.min(columns - 1, Math.floor(point.x * columns / width));
      const cy = Math.min(rows - 1, Math.floor(point.y * rows / height));
      const cell = cy * columns + cx;
      if (cellCounts[cell] >= perCell) continue;
      cellCounts[cell]++;
      selected.push(point);
      if (selected.length >= MAX_FEATURES) break;
    }
    return selected;
  }

  function describeBrief(gray, width, point) {
    const { x, y } = point;
    const center = gray[y * width + x];
    let m10 = 0, m01 = 0;
    for (let dy = -8; dy <= 8; dy++) {
      const span = Math.floor(Math.sqrt(64 - dy * dy));
      const row = (y + dy) * width;
      for (let dx = -span; dx <= span; dx++) {
        const value = gray[row + x + dx] - center;
        m10 += dx * value;
        m01 += dy * value;
      }
    }
    const angle = Math.atan2(m01, m10);
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const descriptor = new Uint8Array(32);
    for (let bit = 0; bit < 256; bit++) {
      const first = BRIEF_PATTERN[bit * 2];
      const second = BRIEF_PATTERN[bit * 2 + 1];
      const x1 = x + Math.round(first[0] * cos - first[1] * sin);
      const y1 = y + Math.round(first[0] * sin + first[1] * cos);
      const x2 = x + Math.round(second[0] * cos - second[1] * sin);
      const y2 = y + Math.round(second[0] * sin + second[1] * cos);
      if (gray[y1 * width + x1] < gray[y2 * width + x2]) descriptor[bit >>> 3] |= 1 << (bit & 7);
    }
    return descriptor;
  }

  async function nativeFeatures(item) {
    const pixels = await alignmentPixels(item);
    const gray = imageDataToGray(pixels.imageData, pixels.width, pixels.height);
    // Release the RGBA analysis buffer as soon as grayscale data has been extracted.
    pixels.imageData = null;
    const candidates = fastCandidates(gray, pixels.width, pixels.height);
    const points = candidates.map((point) => ({
      x: point.x * pixels.scaleX,
      y: point.y * pixels.scaleY,
      descriptor: describeBrief(gray, pixels.width, point)
    }));
    gray.fill(0);
    return points;
  }

  function hammingDistance(a, b) {
    let distance = 0;
    for (let i = 0; i < 32; i++) distance += HAMMING_LUT[a[i] ^ b[i]];
    return distance;
  }

  function collectNativeMatches(sourceFeatures, referenceFeatures) {
    if (sourceFeatures.length < 8 || referenceFeatures.length < 8) return [];
    const forward = new Int32Array(sourceFeatures.length);
    const forwardBest = new Uint16Array(sourceFeatures.length);
    const forwardSecond = new Uint16Array(sourceFeatures.length);
    forward.fill(-1); forwardBest.fill(255); forwardSecond.fill(255);
    const reverseBest = new Uint16Array(referenceFeatures.length);
    reverseBest.fill(255);
    const reverseIndex = new Int32Array(referenceFeatures.length);
    reverseIndex.fill(-1);

    for (let i = 0; i < sourceFeatures.length; i++) {
      if ((i & 31) === 0) checkCancelled();
      const source = sourceFeatures[i].descriptor;
      let best = 256, second = 256, bestIndex = -1;
      for (let j = 0; j < referenceFeatures.length; j++) {
        const distance = hammingDistance(source, referenceFeatures[j].descriptor);
        if (distance < best) { second = best; best = distance; bestIndex = j; }
        else if (distance < second) second = distance;
        if (distance < reverseBest[j]) { reverseBest[j] = distance; reverseIndex[j] = i; }
      }
      forward[i] = bestIndex;
      forwardBest[i] = Math.min(255, best);
      forwardSecond[i] = Math.min(255, second);
    }
    const matches = [];
    for (let i = 0; i < sourceFeatures.length; i++) {
      const j = forward[i];
      if (j < 0 || reverseIndex[j] !== i) continue;
      const best = forwardBest[i], second = forwardSecond[i];
      if (best >= 112 || best >= second * 0.88) continue;
      const source = sourceFeatures[i], target = referenceFeatures[j];
      matches.push({ sx: source.x, sy: source.y, dx: target.x, dy: target.y, distance: best });
    }
    matches.sort((a, b) => a.distance - b.distance);
    return matches.slice(0, 420);
  }

  function similarityFromPair(p, q) {
    const sx = q.sx - p.sx, sy = q.sy - p.sy;
    const dx = q.dx - p.dx, dy = q.dy - p.dy;
    const den = sx * sx + sy * sy;
    if (den < 20) return null;
    const a = (sx * dx + sy * dy) / den;
    const b = (sx * dy - sy * dx) / den;
    const tx = p.dx - (a * p.sx - b * p.sy);
    const ty = p.dy - (b * p.sx + a * p.sy);
    return [a, b, -b, a, tx, ty];
  }

  function residual(m, p) {
    const x = m[0] * p.sx + m[2] * p.sy + m[4] - p.dx;
    const y = m[1] * p.sx + m[3] * p.sy + m[5] - p.dy;
    return Math.hypot(x, y);
  }

  function refineSimilarity(matches) {
    if (matches.length < 2) return null;
    let sx = 0, sy = 0, dx = 0, dy = 0;
    for (const p of matches) { sx += p.sx; sy += p.sy; dx += p.dx; dy += p.dy; }
    sx /= matches.length; sy /= matches.length; dx /= matches.length; dy /= matches.length;
    let numA = 0, numB = 0, den = 0;
    for (const p of matches) {
      const ux = p.sx - sx, uy = p.sy - sy, vx = p.dx - dx, vy = p.dy - dy;
      numA += ux * vx + uy * vy;
      numB += ux * vy - uy * vx;
      den += ux * ux + uy * uy;
    }
    if (den < 1e-6) return null;
    const a = numA / den, b = numB / den;
    return [a, b, -b, a, dx - (a * sx - b * sy), dy - (b * sx + a * sy)];
  }

  function estimateSimilarityRansac(matches) {
    if (matches.length < 8) return null;
    const threshold = 4.2;
    let best = null, bestInliers = [], bestError = Infinity;
    let seed = (matches.length * 2654435761) >>> 0;
    const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
    const iterations = Math.min(480, Math.max(160, matches.length * 2));
    for (let iter = 0; iter < iterations; iter++) {
      const i = Math.floor(random() * matches.length);
      let j = Math.floor(random() * matches.length);
      if (i === j) j = (j + 1) % matches.length;
      const m = similarityFromPair(matches[i], matches[j]);
      if (!m) continue;
      const scale = Math.hypot(m[0], m[1]);
      if (scale < 0.45 || scale > 2.2) continue;
      let inliers = [], errorSum = 0;
      for (const p of matches) {
        const e = residual(m, p);
        if (e < threshold) { inliers.push(p); errorSum += e * e; }
      }
      if (inliers.length > bestInliers.length || (inliers.length === bestInliers.length && errorSum < bestError)) {
        best = m; bestInliers = inliers; bestError = errorSum;
        if (bestInliers.length > matches.length * 0.72) break;
      }
    }
    if (!best || bestInliers.length < 8 || bestInliers.length / matches.length < 0.12) return null;
    let refined = refineSimilarity(bestInliers);
    if (!refined) return null;
    let inliers2 = matches.filter((p) => residual(refined, p) < threshold);
    if (inliers2.length >= 6) refined = refineSimilarity(inliers2) || refined;
    const scale = Math.hypot(refined[0], refined[1]);
    const angle = Math.atan2(refined[1], refined[0]) * 180 / Math.PI;
    return { matrix: refined, inliers: inliers2.length, total: matches.length, ratio: inliers2.length / matches.length, scale, angle };
  }

  async function alignImages(referenceIndex, useAlignment) {
    const reference = items[referenceIndex];
    const transforms = new Array(items.length);
    items.forEach((item) => { item.registrationStatus = ''; item.registrationMessage = ''; });
    if (!useAlignment) {
      items.forEach((item, i) => {
        item.matrixPreview = makePreviewResizeMatrix(item, reference);
        item.matrixFull = previewToFullMatrix(item.matrixPreview, item, reference);
        item.registrationStatus = i === referenceIndex ? 'reference' : 'resized';
        transforms[i] = item.matrixFull;
      });
      addProgressChip('倍率を基準画像に統一');
      return transforms;
    }

    setProgress(8, '画像の位置・倍率を解析しています', 'アプリ内エンジンを初期化中…', 'Pure JavaScript · FAST + oriented BRIEF + RANSAC');
    await nextFrame();
    checkCancelled();
    const referenceFeatures = await nativeFeatures(reference);
    checkCancelled();
    let alignedCount = 1;
    let fallbackCount = 0;

    for (let i = 0; i < items.length; i++) {
      checkCancelled();
      const item = items[i];
      if (i === referenceIndex) {
        item.matrixPreview = [1, 0, 0, 1, 0, 0];
        item.matrixFull = previewToFullMatrix(item.matrixPreview, item, reference);
        item.registrationStatus = 'reference';
        item.registrationMessage = '位置合わせの基準';
        transforms[i] = item.matrixFull;
        continue;
      }
      setProgress(9 + (i / Math.max(1, items.length - 1)) * 19, '画像の位置・倍率を解析しています', `${i + 1} / ${items.length} 枚目を照合中…`, '特徴点の対応から移動・回転・倍率を推定');
      await nextFrame();
      let fit = null;
      try {
        const sourceFeatures = await nativeFeatures(item);
        checkCancelled();
        const matches = collectNativeMatches(sourceFeatures, referenceFeatures);
        fit = estimateSimilarityRansac(matches);
      } catch (error) {
        if (error instanceof CancelledError) throw error;
        console.warn(`位置合わせ失敗 (${item.file.name})`, error);
      }
      if (fit) {
        const candidateFull = previewToFullMatrix(fit.matrix, item, reference);
        const fullScale = Math.sqrt(Math.abs(candidateFull[0] * candidateFull[3] - candidateFull[1] * candidateFull[2]));
        const fullAngle = Math.atan2(candidateFull[1], candidateFull[0]) * 180 / Math.PI;
        const acceptable = fit.inliers >= 8 && fit.ratio >= 0.12 && fullScale >= 0.68 && fullScale <= 1.48 && Math.abs(fullAngle) <= 25;
        if (acceptable) {
          item.matrixPreview = fit.matrix;
          item.matrixFull = candidateFull;
          item.registrationStatus = 'aligned';
          item.registrationMessage = `${fit.inliers}対応点 · 信頼度 ${Math.round(fit.ratio * 100)}%`;
          transforms[i] = candidateFull;
          alignedCount++;
        } else {
          item.matrixPreview = makePreviewResizeMatrix(item, reference);
          item.matrixFull = previewToFullMatrix(item.matrixPreview, item, reference);
          item.registrationStatus = 'fallback';
          item.registrationMessage = '対応点の信頼度が低いため、寸法補正のみ適用';
          transforms[i] = item.matrixFull;
          fallbackCount++;
        }
      } else {
        item.matrixPreview = makePreviewResizeMatrix(item, reference);
        item.matrixFull = previewToFullMatrix(item.matrixPreview, item, reference);
        item.registrationStatus = 'fallback';
        item.registrationMessage = '特徴点が不足したため、寸法補正のみ適用';
        transforms[i] = item.matrixFull;
        fallbackCount++;
      }
      renderList();
      await nextFrame();
    }
    addProgressChip(`${alignedCount}枚を自動位置合わせ`, fallbackCount ? 'warn' : 'done');
    if (fallbackCount) addProgressChip(`${fallbackCount}枚は寸法補正のみ`, 'warn');
    return transforms;
  }

  function computeLaplaceScore(gray, width, height) {
    const count = width * height;
    const lap = new Float32Array(count);
    for (let y = 1; y < height - 1; y++) {
      const row = y * width;
      for (let x = 1; x < width - 1; x++) {
        const i = row + x;
        lap[i] = Math.abs(4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - width] - gray[i + width]);
      }
    }
    const integralW = width + 1;
    const integral = new Float32Array((width + 1) * (height + 1));
    for (let y = 0; y < height; y++) {
      let rowSum = 0;
      const srcRow = y * width;
      const dstRow = (y + 1) * integralW;
      const prevRow = y * integralW;
      for (let x = 0; x < width; x++) {
        rowSum += lap[srcRow + x];
        integral[dstRow + x + 1] = integral[prevRow + x + 1] + rowSum;
      }
    }
    const scores = new Float32Array(count);
    const radius = 2;
    for (let y = 0; y < height; y++) {
      const y0 = Math.max(0, y - radius), y1 = Math.min(height - 1, y + radius);
      for (let x = 0; x < width; x++) {
        const x0 = Math.max(0, x - radius), x1 = Math.min(width - 1, x + radius);
        const a = integral[y0 * integralW + x0];
        const b = integral[y0 * integralW + x1 + 1];
        const c = integral[(y1 + 1) * integralW + x0];
        const d = integral[(y1 + 1) * integralW + x1 + 1];
        scores[y * width + x] = (d - b - c + a) / ((x1 - x0 + 1) * (y1 - y0 + 1));
      }
    }
    return scores;
  }

  async function buildWinnerMap(referenceIndex, transforms) {
    const reference = items[referenceIndex];
    const focusEdge = items.length > 60 ? 640 : MAX_FOCUS_EDGE;
    const scale = Math.min(1, focusEdge / Math.max(reference.width, reference.height));
    const width = Math.max(1, Math.round(reference.width * scale));
    const height = Math.max(1, Math.round(reference.height * scale));
    const count = width * height;
    const winnerMap = new Uint8Array(count); winnerMap.fill(255);
    const bestScore = new Float32Array(count); bestScore.fill(-1);
    const alignedCanvas = document.createElement('canvas');
    alignedCanvas.width = reference.previewWidth; alignedCanvas.height = reference.previewHeight;
    const alignedCtx = alignedCanvas.getContext('2d', { willReadFrequently: true, alpha: false });
    const focusCanvas = document.createElement('canvas'); focusCanvas.width = width; focusCanvas.height = height;
    const focusCtx = focusCanvas.getContext('2d', { willReadFrequently: true, alpha: false });
    const focusToPreviewX = reference.previewWidth / width;
    const focusToPreviewY = reference.previewHeight / height;

    try {
      for (let imageIndex = 0; imageIndex < items.length; imageIndex++) {
        checkCancelled();
        const item = items[imageIndex];
        await ensurePreview(item);
        const bitmap = await createImageBitmap(item.previewBlob);
        alignedCtx.setTransform(1, 0, 0, 1, 0, 0);
        alignedCtx.clearRect(0, 0, alignedCanvas.width, alignedCanvas.height);
        alignedCtx.fillStyle = '#000'; alignedCtx.fillRect(0, 0, alignedCanvas.width, alignedCanvas.height);
        const m = item.matrixPreview || makePreviewResizeMatrix(item, reference);
        alignedCtx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
        alignedCtx.imageSmoothingEnabled = true; alignedCtx.imageSmoothingQuality = 'high';
        alignedCtx.drawImage(bitmap, 0, 0);
        bitmap.close();
        focusCtx.setTransform(1, 0, 0, 1, 0, 0);
        focusCtx.clearRect(0, 0, width, height);
        focusCtx.drawImage(alignedCanvas, 0, 0, width, height);
        const pixels = focusCtx.getImageData(0, 0, width, height).data;
        const gray = new Float32Array(count);
        for (let p = 0, q = 0; p < count; p++, q += 4) gray[p] = 0.299 * pixels[q] + 0.587 * pixels[q + 1] + 0.114 * pixels[q + 2];
        const scores = computeLaplaceScore(gray, width, height);
        const matrixPreview = item.matrixPreview || makePreviewResizeMatrix(item, reference);
        const marginX = Math.max(1.5, item.previewWidth / width * 0.5);
        const marginY = Math.max(1.5, item.previewHeight / height * 0.5);
        for (let y = 0; y < height; y++) {
          const outYPreview = (y + 0.5) * focusToPreviewY;
          for (let x = 0; x < width; x++) {
            const p = y * width + x;
            const outXPreview = (x + 0.5) * focusToPreviewX;
            const sourcePoint = matrixInvertPoint(matrixPreview, outXPreview, outYPreview);
            // Use only actual image pixels; ignore artificial borders generated by affine warping.
            if (sourcePoint.x < marginX || sourcePoint.y < marginY || sourcePoint.x >= item.previewWidth - marginX || sourcePoint.y >= item.previewHeight - marginY) continue;
            const score = scores[p];
            if (score > bestScore[p]) { bestScore[p] = score; winnerMap[p] = imageIndex; }
          }
        }
        setProgress(29 + ((imageIndex + 1) / items.length) * 13, 'ピントの合っている領域を解析しています', `${imageIndex + 1} / ${items.length} 枚目の鮮明さを評価中…`, `${width.toLocaleString()} × ${height.toLocaleString()} の低解像度フォーカスマップを作成`);
        await nextFrame();
      }
    } finally {
      alignedCanvas.width = alignedCanvas.height = focusCanvas.width = focusCanvas.height = 1;
    }
    // The reference image covers its own canvas, so any uncovered sample falls back to it.
    for (let p = 0; p < count; p++) if (winnerMap[p] === 255) winnerMap[p] = referenceIndex;
    addProgressChip('フォーカスマップを作成');
    return { winnerMap, width, height };
  }

  function boxBlurMask(src, tmp, out, width, height, radius) {
    const windowSize = radius * 2 + 1;
    for (let y = 0; y < height; y++) {
      const row = y * width;
      let sum = 0;
      for (let k = -radius; k <= radius; k++) sum += src[row + Math.max(0, Math.min(width - 1, k))];
      tmp[row] = sum / windowSize;
      for (let x = 1; x < width; x++) {
        const addX = Math.min(width - 1, x + radius);
        const removeX = Math.max(0, x - radius - 1);
        sum += src[row + addX] - src[row + removeX];
        tmp[row + x] = sum / windowSize;
      }
    }
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) sum += tmp[Math.max(0, Math.min(height - 1, k)) * width + x];
      out[x] = sum / windowSize;
      for (let y = 1; y < height; y++) {
        const addY = Math.min(height - 1, y + radius);
        const removeY = Math.max(0, y - radius - 1);
        sum += tmp[addY * width + x] - tmp[removeY * width + x];
        out[y * width + x] = sum / windowSize;
      }
    }
  }

  async function buildWeightMaps(winnerMap, mapWidth, mapHeight, referenceIndex, transforms, featherPx) {
    const count = mapWidth * mapHeight;
    const ref = items[referenceIndex];
    const ratioX = ref.width / mapWidth;
    const ratioY = ref.height / mapHeight;
    const radius = Math.max(1, Math.min(8, Math.round(featherPx / Math.sqrt(ratioX * ratioY))));
    const src = new Float32Array(count);
    const tmp = new Float32Array(count);
    const blurred = new Float32Array(count);
    const normalizer = new Float32Array(count);
    const maskMaps = new Array(items.length);
    for (let i = 0; i < items.length; i++) {
      checkCancelled();
      src.fill(0);
      for (let p = 0; p < count; p++) if (winnerMap[p] === i) src[p] = 1;
      boxBlurMask(src, tmp, blurred, mapWidth, mapHeight, radius);
      const mask = new Uint16Array(count);
      const item = items[i];
      const m = transforms[i];
      const marginX = i === referenceIndex ? 0 : Math.max(2, ratioX * 0.55);
      const marginY = i === referenceIndex ? 0 : Math.max(2, ratioY * 0.55);
      for (let y = 0; y < mapHeight; y++) {
        const globalY = (y + 0.5) * ratioY;
        for (let x = 0; x < mapWidth; x++) {
          const p = y * mapWidth + x;
          let weight = blurred[p];
          if (i !== referenceIndex && weight > 0) {
            const globalX = (x + 0.5) * ratioX;
            const sp = matrixInvertPoint(m, globalX, globalY);
            if (sp.x < marginX || sp.y < marginY || sp.x >= item.width - marginX || sp.y >= item.height - marginY) weight = 0;
          }
          if (weight > 0) {
            mask[p] = Math.round(Math.min(1, weight) * 65535);
            normalizer[p] += weight;
          }
        }
      }
      maskMaps[i] = mask;
      setProgress(42 + ((i + 1) / items.length) * 7, '合成マスクを作成しています', `${i + 1} / ${items.length} 枚目の境界マスクを準備中…`, '焦点領域を滑らかにつなぎ、画像の有効範囲を補正');
      await nextFrame();
    }
    const referenceMask = maskMaps[referenceIndex];
    for (let i = 0; i < maskMaps.length; i++) {
      const mask = maskMaps[i];
      for (let p = 0; p < count; p++) {
        const total = normalizer[p];
        if (total > 1e-8) {
          const raw = mask[p] / 65535;
          mask[p] = Math.round(Math.max(0, Math.min(1, raw / total)) * 65535);
        } else {
          mask[p] = 0;
        }
      }
    }
    for (let p = 0; p < count; p++) {
      if (normalizer[p] <= 1e-8) referenceMask[p] = 65535;
    }
    addProgressChip(`境界を約${featherPx}pxなじませ`);
    return { maskMaps, radius };
  }

  function polygonArea(poly) {
    let area = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      area += a.x * b.y - b.x * a.y;
    }
    return area / 2;
  }

  function imagePolygon(item, matrix, inset = 1) {
    const w = Math.max(1, item.width - inset * 2), h = Math.max(1, item.height - inset * 2);
    return [
      matrixApply(matrix, inset, inset),
      matrixApply(matrix, inset + w, inset),
      matrixApply(matrix, inset + w, inset + h),
      matrixApply(matrix, inset, inset + h)
    ];
  }

  function clipPolygon(subject, clipper) {
    let output = subject.slice();
    if (output.length < 3 || clipper.length < 3) return [];
    const orientation = polygonArea(clipper) >= 0 ? 1 : -1;
    for (let i = 0; i < clipper.length; i++) {
      const a = clipper[i], b = clipper[(i + 1) % clipper.length];
      const input = output; output = [];
      if (!input.length) break;
      const inside = (p) => orientation * ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) >= -1e-6;
      const intersection = (p1, p2) => {
        const dx1 = p2.x - p1.x, dy1 = p2.y - p1.y;
        const dx2 = b.x - a.x, dy2 = b.y - a.y;
        const denom = dx1 * dy2 - dy1 * dx2;
        if (Math.abs(denom) < 1e-8) return { x: p2.x, y: p2.y };
        const t = ((a.x - p1.x) * dy2 - (a.y - p1.y) * dx2) / denom;
        return { x: p1.x + t * dx1, y: p1.y + t * dy1 };
      };
      let previous = input[input.length - 1];
      let previousInside = inside(previous);
      for (const current of input) {
        const currentInside = inside(current);
        if (currentInside) {
          if (!previousInside) output.push(intersection(previous, current));
          output.push(current);
        } else if (previousInside) {
          output.push(intersection(previous, current));
        }
        previous = current; previousInside = currentInside;
      }
    }
    return output;
  }

  function pointInPolygon(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i], b = polygon[j];
      const intersect = ((a.y > point.y) !== (b.y > point.y)) && (point.x < (b.x - a.x) * (point.y - a.y) / ((b.y - a.y) || 1e-9) + a.x);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function calculateCrop(referenceIndex, transforms, shouldCrop) {
    const reference = items[referenceIndex];
    if (!shouldCrop) return { x: 0, y: 0, width: reference.width, height: reference.height, cropped: false };
    let polygon = [
      { x: 0, y: 0 }, { x: reference.width, y: 0 },
      { x: reference.width, y: reference.height }, { x: 0, y: reference.height }
    ];
    for (let i = 0; i < items.length; i++) {
      checkCancelled();
      polygon = clipPolygon(polygon, imagePolygon(items[i], transforms[i], i === referenceIndex ? 0 : 1));
      if (polygon.length < 3 || Math.abs(polygonArea(polygon)) < 10000) {
        addProgressChip('共通範囲が狭いためクロップを解除', 'warn');
        return { x: 0, y: 0, width: reference.width, height: reference.height, cropped: false };
      }
    }
    const xs = polygon.map((p) => p.x), ys = polygon.map((p) => p.y);
    const minX = Math.max(0, Math.min(...xs)), maxX = Math.min(reference.width, Math.max(...xs));
    const minY = Math.max(0, Math.min(...ys)), maxY = Math.min(reference.height, Math.max(...ys));
    const centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2;
    const fullW = maxX - minX, fullH = maxY - minY;
    const cornersInside = (factor) => {
      const halfW = fullW * factor / 2, halfH = fullH * factor / 2;
      return [
        { x: centerX - halfW, y: centerY - halfH }, { x: centerX + halfW, y: centerY - halfH },
        { x: centerX + halfW, y: centerY + halfH }, { x: centerX - halfW, y: centerY + halfH }
      ].every((corner) => pointInPolygon(corner, polygon));
    };
    let low = 0, high = 1;
    for (let iter = 0; iter < 32; iter++) {
      const mid = (low + high) / 2;
      if (cornersInside(mid)) low = mid; else high = mid;
    }
    const factor = low;
    const x = Math.max(0, Math.floor(centerX - fullW * factor / 2));
    const y = Math.max(0, Math.floor(centerY - fullH * factor / 2));
    const width = Math.min(reference.width - x, Math.floor(fullW * factor));
    const height = Math.min(reference.height - y, Math.floor(fullH * factor));
    if (width < reference.width * 0.25 || height < reference.height * 0.25 || width < 32 || height < 32) {
      addProgressChip('共通範囲が狭いためクロップを解除', 'warn');
      return { x: 0, y: 0, width: reference.width, height: reference.height, cropped: false };
    }
    addProgressChip(`共通範囲にクロップ ${width}×${height}`);
    return { x, y, width, height, cropped: true };
  }

  function activeLabelsForTile(tile, winnerMap, mapWidth, mapHeight, crop, refWidth, refHeight, radius, itemCount) {
    const x0 = Math.max(0, Math.floor((crop.x + tile.x) * mapWidth / refWidth) - radius - 2);
    const y0 = Math.max(0, Math.floor((crop.y + tile.y) * mapHeight / refHeight) - radius - 2);
    const x1 = Math.min(mapWidth - 1, Math.ceil((crop.x + tile.x + tile.width) * mapWidth / refWidth) + radius + 2);
    const y1 = Math.min(mapHeight - 1, Math.ceil((crop.y + tile.y + tile.height) * mapHeight / refHeight) + radius + 2);
    const seen = new Uint8Array(itemCount);
    const active = [];
    for (let y = y0; y <= y1; y++) {
      let p = y * mapWidth + x0;
      for (let x = x0; x <= x1; x++, p++) {
        const label = winnerMap[p];
        if (label < itemCount && !seen[label]) { seen[label] = 1; active.push(label); }
      }
    }
    if (!seen.some((v) => v)) active.push(0);
    return active;
  }

  function buildTilePlan(outputWidth, outputHeight, tileSize, winnerMap, mapWidth, mapHeight, crop, reference, radius) {
    const plans = [];
    for (let y = 0; y < outputHeight; y += tileSize) {
      for (let x = 0; x < outputWidth; x += tileSize) {
        const tile = { x, y, width: Math.min(tileSize, outputWidth - x), height: Math.min(tileSize, outputHeight - y) };
        tile.active = activeLabelsForTile(tile, winnerMap, mapWidth, mapHeight, crop, reference.width, reference.height, radius, items.length);
        plans.push(tile);
      }
    }
    return plans;
  }

  function createTileMask(maskMap, maskCanvas, tile, crop, reference, mapWidth, mapHeight) {
    const width = tile.width, height = tile.height;
    const imageData = new ImageData(width, height);
    const data = imageData.data;
    const xMap = new Float32Array(width);
    const xBase = new Int32Array(width);
    const xNext = new Int32Array(width);
    for (let x = 0; x < width; x++) {
      const fx = (crop.x + tile.x + x + 0.5) * mapWidth / reference.width - 0.5;
      const clamped = Math.max(0, Math.min(mapWidth - 1, fx));
      xMap[x] = clamped - Math.floor(clamped);
      xBase[x] = Math.floor(clamped);
      xNext[x] = Math.min(mapWidth - 1, xBase[x] + 1);
    }
    for (let y = 0; y < height; y++) {
      const fy = (crop.y + tile.y + y + 0.5) * mapHeight / reference.height - 0.5;
      const cy = Math.max(0, Math.min(mapHeight - 1, fy));
      const y0 = Math.floor(cy), y1 = Math.min(mapHeight - 1, y0 + 1), ty = cy - y0;
      let offset = y * width * 4;
      const row0 = y0 * mapWidth, row1 = y1 * mapWidth;
      for (let x = 0; x < width; x++) {
        const tx = xMap[x];
        const a = maskMap[row0 + xBase[x]], b = maskMap[row0 + xNext[x]];
        const c = maskMap[row1 + xBase[x]], d = maskMap[row1 + xNext[x]];
        const top = a * (1 - tx) + b * tx;
        const bottom = c * (1 - tx) + d * tx;
        const weight = (top * (1 - ty) + bottom * ty) / 65535;
        data[offset + 3] = Math.max(0, Math.min(255, Math.round(weight * 255)));
        offset += 4;
      }
    }
    const ctx = maskCanvas.getContext('2d', { willReadFrequently: false, alpha: true });
    ctx.putImageData(imageData, 0, 0);
  }

  async function renderHighResolution(crop, referenceIndex, transforms, winnerMap, mapWidth, mapHeight, maskMaps, maskRadius) {
    const reference = items[referenceIndex];
    const outputWidth = crop.width, outputHeight = crop.height;
    const tileSize = Number(ui.tileSize.value) || 1024;
    let outputCanvas = document.createElement('canvas');
    try {
      outputCanvas.width = outputWidth; outputCanvas.height = outputHeight;
    } catch (error) {
      throw new Error('出力キャンバスを確保できませんでした。出力画素数がブラウザの上限を超えている可能性があります。');
    }
    const outputCtx = outputCanvas.getContext('2d', { alpha: true, willReadFrequently: false });
    if (!outputCtx) throw new Error('出力キャンバスを初期化できませんでした。');
    outputCtx.clearRect(0, 0, outputWidth, outputHeight);
    const plan = buildTilePlan(outputWidth, outputHeight, tileSize, winnerMap, mapWidth, mapHeight, crop, reference, maskRadius);
    const totalOps = plan.reduce((sum, tile) => sum + tile.active.length, 0);
    let completedOps = 0;
    const tileCanvas = document.createElement('canvas');
    const maskCanvas = document.createElement('canvas');
    const tileCtx = tileCanvas.getContext('2d', { alpha: true, willReadFrequently: false });
    const tileMaskCtx = maskCanvas.getContext('2d', { alpha: true, willReadFrequently: false });
    const perImageTiles = items.map(() => []);
    plan.forEach((tile, tileIndex) => tile.active.forEach((imageIndex) => perImageTiles[imageIndex].push(tileIndex)));
    try {
      for (let imageIndex = 0; imageIndex < items.length; imageIndex++) {
        checkCancelled();
        const indices = perImageTiles[imageIndex];
        if (!indices.length) {
          completedOps += 0;
          continue;
        }
        const item = items[imageIndex];
        setProgress(50 + (completedOps / Math.max(1, totalOps)) * 39, '高解像度タイルを合成しています', `${item.file.name} を読み込み中…`, `元画像は1枚ずつデコード · ${indices.length}タイルで使用`);
        const bitmap = await createImageBitmap(item.file);
        try {
          // The oriented full-resolution bitmap exists only for this source image.
          for (let j = 0; j < indices.length; j++) {
            checkCancelled();
            const tile = plan[indices[j]];
            tileCanvas.width = tile.width; tileCanvas.height = tile.height;
            maskCanvas.width = tile.width; maskCanvas.height = tile.height;
            tileCtx.setTransform(1, 0, 0, 1, 0, 0);
            tileCtx.clearRect(0, 0, tile.width, tile.height);
            tileCtx.globalAlpha = 1;
            tileCtx.globalCompositeOperation = 'source-over';
            tileCtx.imageSmoothingEnabled = true;
            tileCtx.imageSmoothingQuality = 'high';
            const m = transforms[imageIndex];
            tileCtx.setTransform(m[0], m[1], m[2], m[3], m[4] - crop.x - tile.x, m[5] - crop.y - tile.y);
            tileCtx.drawImage(bitmap, 0, 0);
            tileCtx.setTransform(1, 0, 0, 1, 0, 0);
            createTileMask(maskMaps[imageIndex], maskCanvas, tile, crop, reference, mapWidth, mapHeight);
            tileCtx.globalCompositeOperation = 'destination-in';
            tileCtx.drawImage(maskCanvas, 0, 0);
            tileCtx.globalCompositeOperation = 'source-over';
            outputCtx.globalCompositeOperation = 'lighter';
            outputCtx.drawImage(tileCanvas, tile.x, tile.y);
            outputCtx.globalCompositeOperation = 'source-over';
            completedOps++;
            if (completedOps % 8 === 0 || completedOps === totalOps) {
              const pct = 50 + (completedOps / Math.max(1, totalOps)) * 39;
              setProgress(pct, '高解像度タイルを合成しています', `${completedOps.toLocaleString()} / ${totalOps.toLocaleString()} タイル処理`, `${item.file.name} · ${tile.x.toLocaleString()}, ${tile.y.toLocaleString()} px`);
              await nextFrame();
            }
          }
        } finally {
          bitmap.close();
        }
      }
    } catch (error) {
      outputCanvas.width = outputCanvas.height = tileCanvas.width = tileCanvas.height = maskCanvas.width = maskCanvas.height = 1;
      throw error;
    } finally {
      tileCanvas.width = tileCanvas.height = maskCanvas.width = maskCanvas.height = 1;
    }
    addProgressChip(`${outputWidth.toLocaleString()}×${outputHeight.toLocaleString()} pxで書き出し`);
    return outputCanvas;
  }

  async function generateResultPreview(canvas) {
    const scale = Math.min(1, 1400 / Math.max(canvas.width, canvas.height));
    const preview = document.createElement('canvas');
    preview.width = Math.max(1, Math.round(canvas.width * scale));
    preview.height = Math.max(1, Math.round(canvas.height * scale));
    const ctx = preview.getContext('2d', { alpha: false });
    ctx.fillStyle = '#101512'; ctx.fillRect(0, 0, preview.width, preview.height);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(canvas, 0, 0, preview.width, preview.height);
    const blob = await canvasToBlob(preview, 'image/jpeg', 0.86);
    preview.width = preview.height = 1;
    return URL.createObjectURL(blob);
  }

  async function encodeResult(canvas) {
    const format = ui.outputFormat.value;
    const type = format === 'png' ? 'image/png' : 'image/jpeg';
    const quality = format === 'png' ? undefined : Number(ui.jpegQuality.value) / 100;
    setProgress(91, '最終ファイルを書き出しています', `${format === 'png' ? 'PNG可逆圧縮' : `JPEG品質 ${ui.jpegQuality.value}`} でエンコード中…`, 'ブラウザ標準エンコーダーで最終出力を生成');
    await nextFrame();
    const blob = await canvasToBlob(canvas, type, quality);
    return { blob, extension: format === 'png' ? 'png' : 'jpg', mime: type };
  }

  async function runStack() {
    if (busy || items.length < 2) return;
    const referenceId = Number(ui.referenceSelect.value) || items[0].id;
    const referenceIndex = Math.max(0, items.findIndex((item) => item.id === referenceId));
    const reference = items[referenceIndex];
    const megapixels = reference.width * reference.height / 1e6;
    if (megapixels > 65) {
      const proceed = window.confirm(`出力は約${megapixels.toFixed(1)}メガピクセルです。ブラウザのメモリ上限により失敗する可能性があります。続行しますか？\n\nメモリ不足が起きる場合は、出力画素数の小さい基準画像を選ぶか、他のアプリを閉じてください。`);
      if (!proceed) return;
    }
    cancelRequested = false;
    setBusy(true);
    clearProgress();
    ui.resultPanel.hidden = true;
    ui.progressPanel.hidden = false;
    setProgress(2, '処理を準備しています', '画像と設定を確認中…', '画像は端末内で処理されます · 外部依存なし');
    let outputCanvas = null;
    let newResultUrl = null;
    try {
      addProgressChip(`${items.length}枚を処理`);
      addProgressChip(`${formatNumber(reference.width)}×${formatNumber(reference.height)} px`);
      await nextFrame();
      for (const item of items) { checkCancelled(); await ensurePreview(item); }

      if (ui.alignToggle.checked) setProgress(5, 'アプリ内位置合わせを準備しています', '小さな解析画像を生成中…', 'ネットワーク接続・外部ライブラリは不要です');
      const transforms = await alignImages(referenceIndex, ui.alignToggle.checked);
      checkCancelled();
      await nextFrame();

      let focus = await buildWinnerMap(referenceIndex, transforms);
      checkCancelled();
      let maskResult = await buildWeightMaps(focus.winnerMap, focus.width, focus.height, referenceIndex, transforms, Number(ui.featherSelect.value));
      checkCancelled();
      const crop = calculateCrop(referenceIndex, transforms, ui.cropToggle.checked);
      if (!crop.cropped && ui.cropToggle.checked) showToast('共通範囲が狭いため、基準画像の画角を維持します');

      // The compressed analysis previews are no longer needed after the focus maps are built.
      items.forEach((item) => { item.previewBlob = null; });
      setProgress(49, '高解像度タイルを準備しています', '分割計画を作成中…', `${Number(ui.tileSize.value)} pxタイル / ${focus.width.toLocaleString()}×${focus.height.toLocaleString()} フォーカスマップ`);
      await nextFrame();
      outputCanvas = await renderHighResolution(crop, referenceIndex, transforms, focus.winnerMap, focus.width, focus.height, maskResult.maskMaps, maskResult.radius);
      // Drop per-image focus masks before encoding; these can be sizeable for 100-image stacks.
      focus.winnerMap = null;
      maskResult.maskMaps = null;
      focus = null;
      maskResult = null;
      checkCancelled();
      setProgress(90, 'プレビューと出力ファイルを生成しています', '結果プレビューを作成中…', '元画像の寸法は維持されています');
      newResultUrl = await generateResultPreview(outputCanvas);
      const encoded = await encodeResult(outputCanvas);
      checkCancelled();
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      if (lastResultObjectUrl) URL.revokeObjectURL(lastResultObjectUrl);
      resultUrl = URL.createObjectURL(encoded.blob);
      resultBlob = encoded.blob;
      lastResultObjectUrl = newResultUrl;
      ui.resultImage.src = newResultUrl;
      ui.downloadLink.href = resultUrl;
      ui.downloadLink.download = `focus-stack-${new Date().toISOString().slice(0,10)}.${encoded.extension}`;
      ui.resultMeta.textContent = `${crop.width.toLocaleString()} × ${crop.height.toLocaleString()} px · ${items.length}枚 · ${encoded.extension.toUpperCase()} · ${formatBytes(encoded.blob.size)}`;
      ui.resultFootText.textContent = encoded.extension === 'png' ? 'PNGで保存しました。合成後の画素は可逆圧縮で保持されます。' : `JPEG品質 ${ui.jpegQuality.value}/100 で保存しました。JPEG自体は非可逆形式ですが、最高品質設定では最終書き出し時に一度だけ圧縮します。`;
      ui.resultPanel.hidden = false;
      setProgress(100, '深度合成が完了しました', '合成結果を保存できます。', `${crop.width.toLocaleString()} × ${crop.height.toLocaleString()} px · ${formatBytes(encoded.blob.size)}`);
      addProgressChip('完了');
      outputCanvas.width = outputCanvas.height = 1;
      outputCanvas = null;
      showToast('深度合成が完了しました');
      ui.resultPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      if (newResultUrl && newResultUrl !== lastResultObjectUrl) URL.revokeObjectURL(newResultUrl);
      if (outputCanvas) outputCanvas.width = outputCanvas.height = 1;
      if (error instanceof CancelledError || error.name === 'CancelledError') {
        setProgress(0, '処理をキャンセルしました', '処理は途中で停止しました。', '入力画像は削除されていません');
        showToast('処理をキャンセルしました');
      } else {
        console.error(error);
        setProgress(0, '処理を完了できませんでした', error.message || '不明なエラーが発生しました。', '画像サイズを小さくするか、分割サイズを512pxにして再実行してください');
        showToast(error.message || '処理中にエラーが発生しました', true);
      }
    } finally {
      items.forEach((item) => { item.previewBlob = null; });
      setBusy(false);
      renderList();
    }
  }

  ui.fileInput.addEventListener('change', (event) => {
    const files = event.target.files;
    addFiles(files);
    event.target.value = '';
  });
  ui.dropzone.addEventListener('keydown', (event) => {
    if ((event.key === 'Enter' || event.key === ' ') && !busy && !adding) { event.preventDefault(); ui.fileInput.click(); }
  });
  ['dragenter', 'dragover'].forEach((eventName) => ui.dropzone.addEventListener(eventName, (event) => {
    event.preventDefault(); event.stopPropagation();
    if (!busy && !adding) ui.dropzone.classList.add('drag-over');
  }));
  ['dragleave', 'drop'].forEach((eventName) => ui.dropzone.addEventListener(eventName, (event) => {
    event.preventDefault(); event.stopPropagation(); ui.dropzone.classList.remove('drag-over');
  }));
  ui.dropzone.addEventListener('drop', (event) => { if (!busy && !adding) addFiles(event.dataTransfer.files); });
  document.addEventListener('dragover', (event) => event.preventDefault());
  document.addEventListener('drop', (event) => { if (event.target !== ui.dropzone && !ui.dropzone.contains(event.target)) event.preventDefault(); });
  ui.clearAllBtn.addEventListener('click', clearAll);
  ui.referenceSelect.addEventListener('change', () => { renderList(); });
  ui.outputFormat.addEventListener('change', () => {
    ui.jpegQualityBlock.style.display = ui.outputFormat.value === 'png' ? 'none' : '';
    updateEstimate();
  });
  ui.jpegQuality.addEventListener('input', () => { ui.qualityValue.textContent = ui.jpegQuality.value; });
  ui.startBtn.addEventListener('click', runStack);
  ui.cancelBtn.addEventListener('click', () => {
    if (!busy) return;
    cancelRequested = true;
    ui.cancelBtn.disabled = true;
    ui.cancelBtn.textContent = 'キャンセル処理中…';
    ui.progressMessage.textContent = '安全な区切りで停止しています…';
  });
  ui.runAgainBtn.addEventListener('click', () => {
    ui.resultPanel.hidden = true;
    ui.progressPanel.hidden = true;
    ui.startBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  renderList();
  updateEstimate();
})();
