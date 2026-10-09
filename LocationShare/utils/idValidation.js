// Free, instant, offline checks on the TYPED id number, before any AI call.
// This only catches structurally invalid numbers (typos, made-up numbers,
// wrong format). It says nothing about whether the number belongs to a real
// person or matches the uploaded document; that comparison is done by the
// AI extraction step in verify-document.
//
// Verhoeff is the checksum UIDAI uses for the last digit of an Aadhaar
// number. It detects every single-digit transcription error.

const D = [
  [0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],
  [3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],
  [6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],
  [9,8,7,6,5,4,3,2,1,0],
];
const P = [
  [0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],
  [8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],
  [2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8],
];

export function verhoeffIsValid(numStr) {
  let c = 0;
  const digits = numStr.split('').reverse().map(Number);
  for (let i = 0; i < digits.length; i++) c = D[c][P[i % 8][digits[i]]];
  return c === 0;
}

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

// Returns { valid, message }. message is null when valid or when the doc
// type has no reliable automatic format check (Passport, Voter ID).
export function checkIdNumberFormat(docType, rawValue) {
  const value = (rawValue || '').trim();
  if (!value) return { valid: true, message: null };

  if (docType === 'Aadhaar') {
    const digits = value.replace(/\s/g, '');
    if (!/^\d{12}$/.test(digits)) return { valid: false, message: 'Aadhaar numbers are 12 digits.' };
    if (!verhoeffIsValid(digits)) {
      return { valid: false, message: "This doesn't look like a valid Aadhaar number. Please double-check it." };
    }
    return { valid: true, message: null };
  }
  if (docType === 'PAN Card') {
    if (!PAN_REGEX.test(value.toUpperCase())) {
      return { valid: false, message: 'PAN should be 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F).' };
    }
    return { valid: true, message: null };
  }
  return { valid: true, message: null };
}
