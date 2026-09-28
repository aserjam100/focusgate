export function countWords(text) {
  const m = String(text || '').trim().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return m ? m.length : 0;
}

/** Exact phrase match, case-insensitive; only surrounding whitespace is ignored. */
export function phraseMatches(typed, phrase) {
  return String(typed).trim().toLocaleLowerCase() === String(phrase).trim().toLocaleLowerCase();
}
