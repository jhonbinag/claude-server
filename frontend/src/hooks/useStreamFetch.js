import { useState, useRef, useCallback } from 'react';

/**
 * Generic SSE streaming hook.
 *
 * Usage:
 *   const { isRunning, stream, stop } = useStreamFetch();
 *   await stream(url, body, (eventType, data) => { ... }, apiKey);
 *
 * The callback receives (eventType: string, data: object) for every SSE event.
 */
export function useStreamFetch() {
  const [isRunning, setIsRunning] = useState(false);
  const readerRef  = useRef(null);
  const abortedRef = useRef(false);

  const stream = useCallback(async (url, body, onEvent, locationId) => {
    setIsRunning(true);
    abortedRef.current = false;

    try {
      const res = await fetch(url, {
        method:  'POST',
        headers: { 'x-location-id': locationId, 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });

      if (!res.ok) {
        onEvent('error', { error: `HTTP ${res.status} — ${res.statusText}` });
        return;
      }

      const reader  = res.body.getReader();
      readerRef.current = reader;
      const decoder = new TextDecoder();
      let   buffer  = '';

      while (true) {
        if (abortedRef.current) break;
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop(); // keep incomplete chunk

        for (const chunk of parts) {
          const evtMatch  = chunk.match(/^event:\s*(\w+)/m);
          const dataMatch = chunk.match(/^data:\s*(.+)$/m);
          if (!evtMatch || !dataMatch) continue;
          try {
            onEvent(evtMatch[1], JSON.parse(dataMatch[1]));
          } catch {}
        }
      }
    } catch (err) {
      if (!abortedRef.current) {
        onEvent('error', { error: err.message });
      }
    } finally {
      readerRef.current = null;
      setIsRunning(false);
    }
  }, []);

  const stop = useCallback(() => {
    abortedRef.current = true;
    readerRef.current?.cancel();
  }, []);

  return { isRunning, stream, stop };
}
