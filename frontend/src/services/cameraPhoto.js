// Only camera captures are resized. Gallery uploads keep their original bytes.
export async function prepareCameraPhoto(file) {
  if (!file || file.size > 20 * 1024 * 1024) throw new Error('촬영 사진은 20MB 이하로 선택해 주세요.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const width = image.naturalWidth, height = image.naturalHeight;
    if (Math.min(width, height) < 128 || width * height > 32_000_000) {
      throw new Error('사진 크기를 줄이거나 카드를 더 크게 촬영해 주세요.');
    }
    const ratio = Math.min(1, 2048 / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    if (Math.min(canvas.width, canvas.height) < 128) throw new Error('카드 전체가 보이도록 다시 촬영해 주세요.');
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .9));
    if (!blob || blob.size > 5 * 1024 * 1024) throw new Error('사진 크기를 줄여 다시 촬영해 주세요.');
    return new File([blob], 'camera-card.jpg', { type: 'image/jpeg' });
  } catch (error) {
    if (error.name === 'EncodingError') throw new Error('사진을 읽지 못했습니다. JPG 또는 PNG로 다시 촬영해 주세요.');
    throw error;
  } finally { URL.revokeObjectURL(url); }
}
