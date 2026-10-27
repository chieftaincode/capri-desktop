'use strict';

// Read OpenAI-compatible SSE replies, including a last data line without a newline.
async function readChatStream(body, onDelta) {
  const decoder = new TextDecoder();
  let buffer = '', text = '', finishReason = null, done = false;
  const readLine = (line) => {
    line = line.trim();
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (data === '[DONE]') { done = true; return; }
    const msg = JSON.parse(data);
    if (msg.error) throw new Error(msg.error.message || msg.error);
    const choice = msg.choices?.[0];
    const piece = choice?.delta?.content || '';
    if (piece) { text += piece; onDelta(piece); }
    if (choice?.finish_reason) finishReason = choice.finish_reason;
  };
  try {
    for await (const chunk of body) {
      buffer += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        readLine(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
        if (done) return { text, finishReason };
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) readLine(buffer);
    if (!done && !finishReason) throw new Error('The connection ended before the answer was complete. Please try again.');
    return { text, finishReason };
  } catch (err) {
    err.partialText = text;
    throw err;
  }
}

module.exports = { readChatStream };
