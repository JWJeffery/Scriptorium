import mammoth from "mammoth";

export type DocxExtractionResult = {
  text: string;
  warningCount: number;
  messages: string[];
};

export async function extractDocxRawText(file: File): Promise<DocxExtractionResult> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await mammoth.extractRawText({ buffer });
  const text = result.value.trim();
  const messages = result.messages.map((message) => `${message.type}: ${message.message}`);

  if (!text) {
    throw new Error("DOCX extraction produced no readable text.");
  }

  return {
    text,
    warningCount: result.messages.length,
    messages
  };
}
