/* Lightweight document scanner worker. No WASM startup is required. */
function otsuThreshold(gray) {
  const histogram = new Uint32Array(256)
  for (let index = 0; index < gray.length; index++) histogram[gray[index]]++
  let totalSum = 0
  for (let value = 0; value < 256; value++) totalSum += value * histogram[value]
  let count = 0; let sum = 0; let best = -1; let threshold = 127
  for (let value = 0; value < 256; value++) {
    count += histogram[value]; if (!count) continue
    const remaining = gray.length - count; if (!remaining) break
    sum += value * histogram[value]
    const difference = sum / count - (totalSum - sum) / remaining
    const variance = count * remaining * difference * difference
    if (variance > best) { best = variance; threshold = value }
  }
  return threshold
}

function detect(data) {
  const rgba = new Uint8ClampedArray(data.buffer); const length = data.width * data.height
  const gray = new Uint8Array(length)
  for (let index = 0, pixel = 0; pixel < length; pixel++, index += 4) gray[pixel] = (rgba[index] * 77 + rgba[index + 1] * 150 + rgba[index + 2] * 29) >> 8
  const threshold = otsuThreshold(gray); const cx = data.width >> 1; const cy = data.height >> 1
  let centerSum = 0; let samples = 0
  for (let y = cy - 8; y <= cy + 8; y += 2) for (let x = cx - 8; x <= cx + 8; x += 2) { centerSum += gray[y * data.width + x]; samples++ }
  const paperIsLight = centerSum / samples >= threshold
  const matches = index => paperIsLight ? gray[index] > threshold : gray[index] <= threshold
  let seed = cy * data.width + cx
  if (!matches(seed)) for (let radius = 1; radius < 30 && !matches(seed); radius++) {
    for (const [x, y] of [[cx - radius, cy], [cx + radius, cy], [cx, cy - radius], [cx, cy + radius]]) {
      if (x >= 0 && y >= 0 && x < data.width && y < data.height && matches(y * data.width + x)) { seed = y * data.width + x; break }
    }
  }
  if (!matches(seed)) return null
  const visited = new Uint8Array(length); const queue = new Int32Array(length); let head = 0; let tail = 0
  queue[tail++] = seed; visited[seed] = 1
  let tl = null; let tr = null; let br = null; let bl = null
  while (head < tail) {
    const index = queue[head++]; const x = index % data.width; const y = (index / data.width) | 0
    if (!tl || x + y < tl.score) tl = { x, y, score: x + y }
    if (!br || x + y > br.score) br = { x, y, score: x + y }
    if (!tr || x - y > tr.score) tr = { x, y, score: x - y }
    if (!bl || y - x > bl.score) bl = { x, y, score: y - x }
    const neighbors = [index - 1, index + 1, index - data.width, index + data.width]
    for (let n = 0; n < 4; n++) {
      const next = neighbors[n]
      if (next < 0 || next >= length || visited[next] || (n === 0 && x === 0) || (n === 1 && x === data.width - 1)) continue
      if (matches(next)) { visited[next] = 1; queue[tail++] = next }
    }
  }
  const areaRatio = tail / length
  if (areaRatio < .12 || areaRatio > .94) return null
  return { points: [tl, tr, br, bl].map(({ x, y }) => ({ x, y })), area: tail }
}

function solveLinear(matrix, values) {
  const size = values.length
  for (let column = 0; column < size; column++) {
    let pivot = column
    for (let row = column + 1; row < size; row++) if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) pivot = row
    ;[matrix[column], matrix[pivot]] = [matrix[pivot], matrix[column]]; [values[column], values[pivot]] = [values[pivot], values[column]]
    const divisor = matrix[column][column]
    if (Math.abs(divisor) < 1e-9) throw new Error('Bốn góc crop không hợp lệ.')
    for (let cell = column; cell < size; cell++) matrix[column][cell] /= divisor
    values[column] /= divisor
    for (let row = 0; row < size; row++) if (row !== column) {
      const factor = matrix[row][column]
      for (let cell = column; cell < size; cell++) matrix[row][cell] -= factor * matrix[column][cell]
      values[row] -= factor * values[column]
    }
  }
  return values
}

function perspective(data) {
  const destination = [[0, 0], [data.width - 1, 0], [data.width - 1, data.height - 1], [0, data.height - 1]]
  const matrix = []; const values = []
  for (let index = 0; index < 4; index++) {
    const [x, y] = destination[index]; const { x: u, y: v } = data.corners[index]
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); values.push(u)
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y]); values.push(v)
  }
  const h = solveLinear(matrix, values); const source = new Uint8ClampedArray(data.buffer)
  const output = new Uint8ClampedArray(data.width * data.height * 4)
  for (let y = 0, offset = 0; y < data.height; y++) for (let x = 0; x < data.width; x++, offset += 4) {
    const denominator = h[6] * x + h[7] * y + 1
    const sx = Math.max(0, Math.min(data.sourceWidth - 1, (h[0] * x + h[1] * y + h[2]) / denominator))
    const sy = Math.max(0, Math.min(data.sourceHeight - 1, (h[3] * x + h[4] * y + h[5]) / denominator))
    const x0 = sx | 0; const y0 = sy | 0; const x1 = Math.min(x0 + 1, data.sourceWidth - 1); const y1 = Math.min(y0 + 1, data.sourceHeight - 1)
    const fx = sx - x0; const fy = sy - y0
    const p00 = (y0 * data.sourceWidth + x0) * 4; const p10 = (y0 * data.sourceWidth + x1) * 4
    const p01 = (y1 * data.sourceWidth + x0) * 4; const p11 = (y1 * data.sourceWidth + x1) * 4
    const sampled = [0, 0, 0]
    for (let channel = 0; channel < 3; channel++) sampled[channel] = source[p00 + channel] * (1 - fx) * (1 - fy) + source[p10 + channel] * fx * (1 - fy) + source[p01 + channel] * (1 - fx) * fy + source[p11 + channel] * fx * fy
    const settings = data.settings || {}; const brightness = settings.brightness || 0
    const contrast = Math.max(-100, Math.min(100, settings.contrast || 0)); const factor = (259 * (contrast + 255)) / (255 * (259 - contrast))
    let red = factor * (sampled[0] - 128) + 128 + brightness * 2.55
    let green = factor * (sampled[1] - 128) + 128 + brightness * 2.55
    let blue = factor * (sampled[2] - 128) + 128 + brightness * 2.55
    let luminance = red * .299 + green * .587 + blue * .114
    if (settings.filter === 'document') {
      luminance = Math.max(0, Math.min(255, (luminance - 105) * 1.65 + 128))
      red = green = blue = luminance > 218 ? 255 : luminance
    } else if (settings.filter === 'grayscale') red = green = blue = luminance
    else if (settings.filter === 'black-white') red = green = blue = luminance >= (settings.threshold || 128) ? 255 : 0
    output[offset] = red; output[offset + 1] = green; output[offset + 2] = blue; output[offset + 3] = 255
  }
  const sharpen = Math.max(0, Math.min(100, data.settings?.sharpen || 0)) / 100
  if (sharpen > 0 && data.width > 2 && data.height > 2) {
    const original = output.slice(); const center = 1 + sharpen * 4; const neighbor = -sharpen
    for (let y = 1; y < data.height - 1; y++) for (let x = 1; x < data.width - 1; x++) {
      const offset = (y * data.width + x) * 4
      for (let channel = 0; channel < 3; channel++) output[offset + channel] = original[offset + channel] * center + neighbor * (original[offset - 4 + channel] + original[offset + 4 + channel] + original[offset - data.width * 4 + channel] + original[offset + data.width * 4 + channel])
    }
  }
  return { buffer: output.buffer, width: data.width, height: data.height }
}

self.onmessage = event => {
  const { id, type, payload } = event.data
  try {
    const result = type === 'detect' ? detect(payload) : perspective(payload)
    self.postMessage({ id, result }, result && result.buffer ? [result.buffer] : [])
  } catch (error) { self.postMessage({ id, error: error instanceof Error ? error.message : String(error) }) }
}
