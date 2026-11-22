// DocumentVersion.extractionState values written by the OCR job. Kept apart from handlers.ts so the
// worker's bookkeeping (reconciliation) can use them without loading the OCR and PDF libraries.
export const OCR_DONE_STATE = "tesseract-js-eng-v1";
export const OCR_RUNNING_STATE = "tesseract-js-eng-v1-running";
export const OCR_FAILED_STATE = "tesseract-js-eng-v1-failed";
export const OCR_NO_TEXT_STATE = "tesseract-js-eng-v1-no-text";
export const OCR_TIMEOUT_STATE = "tesseract-js-eng-v1-timed-out";
