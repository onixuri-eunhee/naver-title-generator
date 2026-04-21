export function isScriptCompleteEvent(result) {
  return Boolean(result && typeof result === 'object' && result.script);
}

export function isRenderCompleteEvent(result) {
  return Boolean(result && typeof result === 'object' && result.url);
}
