/**
 * Word count utility complying strictly with IELTS testing standards.
 * Counts alphanumeric words, handles hyphens, apostrophes, ignores extra spaces, tabs, and line breaks.
 */
function countWords(text) {
  if (!text || typeof text !== 'string') return 0;
  
  // Replace smart quotes and special whitespace
  const sanitized = text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .trim();

  if (!sanitized) return 0;

  // Split on whitespace sequences (spaces, tabs, newlines)
  const tokens = sanitized.split(/\s+/);
  
  // Filter tokens that contain at least one alphanumeric character
  // E.g., standalone punctuation like "-" or "..." should not be counted as words
  const validWords = tokens.filter(token => {
    return /[a-zA-Z0-9\u00C0-\u024F\u1EA0-\u1EF9]/.test(token);
  });

  return validWords.length;
}

/**
 * Calculates IELTS Overall Band from 4 criteria according to official IELTS conventions.
 * TA: Task Achievement
 * CC: Coherence & Cohesion
 * LR: Lexical Resource
 * GRA: Grammatical Range & Accuracy
 */
function calculateOverallBand(ta, cc, lr, gra) {
  const scores = [Number(ta) || 0, Number(cc) || 0, Number(lr) || 0, Number(gra) || 0];
  const sum = scores.reduce((a, b) => a + b, 0);
  const average = sum / 4;

  const floor = Math.floor(average);
  const remainder = average - floor;

  let roundedBand;
  if (remainder < 0.25) {
    roundedBand = floor;
  } else if (remainder < 0.75) {
    roundedBand = floor + 0.5;
  } else {
    roundedBand = floor + 1.0;
  }

  return {
    rawAverage: Math.round(average * 1000) / 1000,
    overallBand: Math.min(9.0, Math.max(0, roundedBand)),
    explanation: `(${scores.join(' + ')}) / 4 = ${average.toFixed(3)} -> Làm tròn chuẩn IELTS: ${roundedBand.toFixed(1)}`
  };
}

module.exports = {
  countWords,
  calculateOverallBand
};
