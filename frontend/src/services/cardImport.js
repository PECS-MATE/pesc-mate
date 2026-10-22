export const MAX_IMPORT_FILES = 20;
const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function filenameLabel(name) {
  return name.replace(/\.(?:png|jpe?g|webp)$/i, '').normalize('NFKC').replace(/_+/g, ' ').trim();
}

export function labelKey(label) {
  return label.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

export function fileIssue(file) {
  if (!TYPES.includes(file.type)) return 'JPG, PNG, WebP 파일만 선택해 주세요.';
  if (!file.size || file.size > MAX_BYTES) return '비어 있지 않은 5MiB 이하 파일을 선택해 주세요.';
  return '';
}

export function importIssues(row, rows, existingCards, categories) {
  const issues = [];
  if (row.fileError) issues.push(row.fileError);
  if (!/^[가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9 ]{1,30}$/.test(row.label.trim())) {
    issues.push('카드명은 한글·영문·숫자·공백으로 1~30자 입력해 주세요.');
  }
  if (!row.meaning.trim() || row.meaning.trim().length > 120) issues.push('카드 뜻을 1~120자 입력해 주세요.');
  if (!categories.some(category => category.name === row.category)) issues.push('카테고리를 선택해 주세요.');
  const key = labelKey(row.label);
  if (key && (rows.some(other => other.id !== row.id && labelKey(other.label) === key)
      || existingCards.some(card => card.status !== 'rejected' && labelKey(card.label) === key))) {
    issues.push('중복 후보: 선택한 사진 또는 이 사용자의 등록 카드와 이름이 같습니다. 이름을 확인해 주세요.');
  }
  return issues;
}
