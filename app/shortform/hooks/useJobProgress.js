'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * 숏폼 진행 상태 SSE 구독 훅.
 *
 * 사용:
 *   const { steps, current, status, result, error, cancel } = useJobProgress(jobId, { authToken });
 *
 * Returns:
 *   - steps: { [stepId]: { status: 'idle'|'running'|'done'|'error', progress, subStep, result } }
 *   - current: 현재 running 중인 step id (없으면 null)
 *   - status: 'idle' | 'running' | 'complete' | 'error' | 'cancelled'
 *   - result: complete 시 payload
 *   - error: error/cancelled 시 메시지
 *   - cancel(): 취소 호출
 */
export function useJobProgress(jobId, { authToken } = {}) {
  const [steps, setSteps] = useState({});
  const [current, setCurrent] = useState(null);
  const [status, setStatus] = useState('idle');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const esRef = useRef(null);

  useEffect(() => {
    if (!jobId) return undefined;
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
      return undefined;
    }

    setStatus('running');
    setSteps({});
    setCurrent(null);
    setResult(null);
    setError(null);

    const es = new EventSource(
      `/api/shortform-progress?jobId=${encodeURIComponent(jobId)}`,
    );
    esRef.current = es;

    const handleStep = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        setSteps((prev) => ({
          ...prev,
          [data.step]: {
            status: data.status,
            progress: data.progress ?? 0,
            subStep: data.subStep || null,
            result: data.result || null,
          },
        }));
        if (data.status === 'running') {
          setCurrent(data.step);
        }
      } catch (err) {
        console.error('[useJobProgress] step parse:', err);
      }
    };

    const handleComplete = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        setResult(data.result || data);
        setStatus('complete');
        setCurrent(null);
      } catch (err) {
        console.error('[useJobProgress] complete parse:', err);
      } finally {
        es.close();
      }
    };

    const handleErrorEvent = (ev) => {
      // SSE 내부 onerror 와 'error' named event 가 공유됨 → data 존재 여부로 구분
      if (!ev?.data) return;
      try {
        const data = JSON.parse(ev.data);
        if (data?.error) {
          setError(data.error);
          setStatus('error');
          setCurrent(null);
        }
      } catch {}
    };

    const handleCancelled = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        setStatus('cancelled');
        setCurrent(null);
        setError(data?.note || '취소되었습니다.');
      } catch {}
      finally {
        es.close();
      }
    };

    es.addEventListener('step', handleStep);
    es.addEventListener('complete', handleComplete);
    es.addEventListener('error', handleErrorEvent);
    es.addEventListener('cancelled', handleCancelled);

    es.onerror = () => {
      // 네트워크 단절: EventSource가 자동 재연결하므로 UI상 status는 유지
      console.warn('[useJobProgress] EventSource error, 자동 재연결 대기');
    };

    return () => {
      es.removeEventListener('step', handleStep);
      es.removeEventListener('complete', handleComplete);
      es.removeEventListener('error', handleErrorEvent);
      es.removeEventListener('cancelled', handleCancelled);
      es.close();
      esRef.current = null;
    };
  }, [jobId]);

  const cancel = useCallback(async () => {
    if (!jobId) return;
    try {
      const res = await fetch(
        `/api/shortform-cancel?jobId=${encodeURIComponent(jobId)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
          body: JSON.stringify({}),
        },
      );
      if (!res.ok) {
        console.warn('[useJobProgress] cancel 실패:', res.status);
      }
    } catch (err) {
      console.error('[useJobProgress] cancel 에러:', err);
    }
  }, [jobId, authToken]);

  const reset = useCallback(() => {
    setSteps({});
    setCurrent(null);
    setStatus('idle');
    setResult(null);
    setError(null);
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  }, []);

  return { steps, current, status, result, error, cancel, reset };
}
