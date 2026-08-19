const MAX_TOKENS = 400;
const OVERLAP = 50;

export function chunkTextExact(text: string): string[] {
  const paragraphs = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let currentChunk = "";
  
  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;
    
    const sentences = trimmed.split(/[.!?]+/).filter((s: string) => s.trim().length > 0);
    
    for (const sentence of sentences) {
      const sentenceTrimmed = sentence.trim();
      if (sentenceTrimmed.length <= 0) continue;
      
      if (currentChunk.length + sentenceTrimmed.length + 1 > MAX_TOKENS) {
        if (currentChunk.length > 0) {
          chunks.push(currentChunk);
        }
        const overlapStart = currentChunk.length - OVERLAP;
        currentChunk = overlapStart > 0 ? currentChunk.slice(overlapStart) : sentenceTrimmed;
      } else {
        if (currentChunk.length > 0) currentChunk += " ";
        currentChunk += sentenceTrimmed;
      }
    }
  }
  
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }
  
  return chunks;
}