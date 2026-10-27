// A rolling conversation must start with the user's question, not an orphaned
// assistant answer. Previously this happened on every turn after ten exchanges.
export function chatContext(history, limit) {
  const recent = history.slice(-limit);
  while (recent.length && recent[0].role !== 'user') recent.shift();
  // Older versions stored an ellipsis for empty provider replies. Keep the saved
  // history intact, but do not teach the model to imitate those placeholders.
  return recent.filter((message) => message.role !== 'assistant'
    || !/^[\s.…]*$/.test(message.content));
}
