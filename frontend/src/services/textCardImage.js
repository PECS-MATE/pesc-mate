// A normal PNG keeps word-only cards compatible with print, offline and RFID flows.
export async function textCardImage(label) {
  await document.fonts.ready;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 1024, 1024);
  ctx.fillStyle = '#344b46'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  let lines = [];
  let size = 180;
  for (; size >= 32; size -= 4) {
    ctx.font = `600 ${size}px sans-serif`;
    lines = [''];
    for (const character of label) {
      const last = lines.length - 1;
      if (ctx.measureText(lines[last] + character).width > 820) lines.push(character);
      else lines[last] += character;
    }
    if (lines.length * size * 1.4 <= 800) break;
  }
  lines.forEach((line, index) => ctx.fillText(line.trim(), 512,
    512 + (index - (lines.length - 1) / 2) * size * 1.4));
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob
    ? resolve(blob) : reject(new Error('글자 카드 이미지를 만들지 못했습니다.')), 'image/png'));
}
