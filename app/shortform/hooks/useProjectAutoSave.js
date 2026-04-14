'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * 숏폼 프로젝트 자동 저장 훅 (Phase C).
 *
 * 사용 예 (Phase H에서 활성화 예정):
 *   const { projectId, saveNow, isSaving, lastSavedAt } = useProjectAutoSave({
 *     authToken,                 // localStorage ddukddak_token
 *     enabled: !!email,          // 로그인한 사용자만
 *     snapshot: {                // 저장할 state 스냅샷 (변경 시 자동 debounce 저장)
 *       current_step,
 *       blog_text, keywords, user_experience, persona, tone, duration_sec,
 *       script_json, preset, ...
 *     },
 *     debounceMs: 1500,
 *   });
 *
 * 동작:
 * - enabled=false → 모든 네트워크 호출 스킵 (no-op). Phase C 기본값.
 * - enabled=true + projectId 없음 → 첫 snapshot 유의미 변경 시 POST로 draft 생성
 * - projectId 존재 → snapshot 변경 시 debounce 후 PATCH
 * - saveNow()는 debounce 무시 즉시 저장 (Step 이동 직전 호출)
 *
 * Phase H will enable this (현재 Phase C는 훅만 추가, ShortformClient 통합은 Phase H).
 */
export default function useProjectAutoSave({
  authToken = null,
  enabled = false, // Phase H will enable this
  snapshot = null,
  debounceMs = 1500,
  initialProjectId = null,
} = {}) {
  const [projectId, setProjectId] = useState(initialProjectId);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [error, setError] = useState(null);

  // 최신 snapshot 참조 (stale closure 방지)
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  const timerRef = useRef(null);
  const pendingCreateRef = useRef(false);
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;

  const headers = useCallback(() => ({
    'Content-Type': 'application/json',
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
  }), [authToken]);

  const doCreate = useCallback(async () => {
    if (pendingCreateRef.current) return null;
    pendingCreateRef.current = true;
    try {
      const res = await fetch('/api/shortform-projects', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(snapshotRef.current || {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'create failed');
      setProjectId(data.project.id);
      setLastSavedAt(new Date());
      setError(null);
      return data.project.id;
    } catch (err) {
      console.warn('[useProjectAutoSave] create failed:', err.message);
      setError(err.message);
      return null;
    } finally {
      pendingCreateRef.current = false;
    }
  }, [headers]);

  const doPatch = useCallback(async (id) => {
    if (!id) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/shortform-projects/${id}`, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify(snapshotRef.current || {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'patch failed');
      setLastSavedAt(new Date());
      setError(null);
    } catch (err) {
      console.warn('[useProjectAutoSave] patch failed:', err.message);
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  }, [headers]);

  /**
   * 즉시 저장 (debounce 무시). Step 이동 직전, publish 직전에 호출.
   * 저장 완료 후 projectId 반환 (신규 생성 포함).
   */
  const saveNow = useCallback(async () => {
    if (!enabled) return null;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    let id = projectIdRef.current;
    if (!id) {
      id = await doCreate();
      return id;
    }
    await doPatch(id);
    return id;
  }, [enabled, doCreate, doPatch]);

  // snapshot 변경 감지 → debounce 저장
  useEffect(() => {
    if (!enabled) return;
    if (!snapshot) return;

    // 최초 의미 있는 입력이 있을 때만 draft 생성
    const hasMeaningfulInput =
      (snapshot.blog_text && snapshot.blog_text.length >= 10) ||
      (snapshot.keywords && (Array.isArray(snapshot.keywords)
        ? snapshot.keywords.length > 0
        : String(snapshot.keywords).trim().length >= 2)) ||
      snapshot.script_json;

    if (!projectIdRef.current && !hasMeaningfulInput) {
      return; // 빈 폼은 저장 안 함
    }

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      if (!projectIdRef.current) {
        await doCreate();
      } else {
        await doPatch(projectIdRef.current);
      }
    }, debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // snapshot을 JSON 직렬화해서 비교 — shallow 변경 감지
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, debounceMs, JSON.stringify(snapshot)]);

  return { projectId, saveNow, isSaving, lastSavedAt, error };
}
