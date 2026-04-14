'use client';

import { useEffect, useState } from 'react';
import { getToken } from '@/lib/auth';
import styles from './BrandKitSection.module.css';

const EMPTY = {
  store_name: '',
  slogan: '',
  industry: '',
  logo_url: '',
  primary_color: '',
  secondary_color: '',
  font_family: '',
  signature_intro: '',
  signature_outro: '',
  default_cta: '',
  location: '',
  business_hours: '',
  phone: '',
  instagram: '',
};

const INDUSTRIES = [
  '카페/베이커리', '식당/주점', '미용실/뷰티', '의류/잡화',
  '교육/학원', '피트니스/요가', '병원/클리닉', '웨딩/이벤트',
  '전문직/컨설팅', '프리랜서/1인사업', '기타',
];

const FONTS = [
  'Noto Sans KR',
  'Pretendard',
  'IBM Plex Sans KR',
  'Nanum Square',
  'Gmarket Sans',
];

export default function BrandKitSection() {
  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [error, setError] = useState('');
  const [isEmpty, setIsEmpty] = useState(true);
  const [logoUploading, setLogoUploading] = useState(false);

  async function refresh() {
    const token = getToken();
    if (!token) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/brand-kit', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '브랜드 킷을 불러오지 못했습니다.');
      } else if (data.kit) {
        // null 값을 빈 문자열로 치환
        const clean = { ...EMPTY };
        for (const k of Object.keys(EMPTY)) {
          if (data.kit[k] != null) clean[k] = data.kit[k];
        }
        setForm(clean);
        setIsEmpty(false);
      } else {
        setIsEmpty(true);
      }
    } catch {
      setError('네트워크 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleLogoChange(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      setError('로고는 JPG 또는 PNG만 가능합니다.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('로고 파일은 2MB 이하만 가능합니다.');
      return;
    }

    const token = getToken();
    if (!token) return;

    setLogoUploading(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('tag', 'brand-logo');
      const res = await fetch('/api/my-images', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '로고 업로드에 실패했습니다.');
      } else if (data.image?.public_url) {
        update('logo_url', data.image.public_url);
      }
    } catch {
      setError('네트워크 오류가 발생했습니다.');
    } finally {
      setLogoUploading(false);
    }
  }

  function removeLogo() {
    update('logo_url', '');
  }

  async function handleSave() {
    const token = getToken();
    if (!token) return;
    setSaving(true);
    setError('');
    setSavedMsg('');
    try {
      const res = await fetch('/api/brand-kit', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '저장에 실패했습니다.');
      } else {
        setIsEmpty(false);
        setSavedMsg('저장되었습니다. 모든 영상에 자동 적용됩니다.');
        setTimeout(() => setSavedMsg(''), 3000);
      }
    } catch {
      setError('네트워크 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm('브랜드 킷을 삭제할까요? 저장된 모든 정보가 사라집니다.')) return;
    const token = getToken();
    const res = await fetch('/api/brand-kit', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      setForm(EMPTY);
      setIsEmpty(true);
    } else {
      alert('삭제에 실패했습니다.');
    }
  }

  if (loading) {
    return <div className={styles.loadingText}>불러오는 중...</div>;
  }

  return (
    <div className={styles.root} id="brand-kit">
      <div className={styles.header}>
        <div className={styles.title}>내 브랜드 킷</div>
        <div className={styles.subtitle}>
          한 번 저장하면 모든 숏폼에 자동 적용됩니다
        </div>
      </div>

      {isEmpty && (
        <div className={styles.emptyBanner}>
          1분만 투자하면 모든 영상이 더 일관성 있어져요.
          가게명/시그니처 멘트/연락처만 채워도 충분합니다.
        </div>
      )}

      {error && <div className={styles.errorText}>{error}</div>}
      {savedMsg && <div className={styles.savedText}>{savedMsg}</div>}

      {/* 그룹 1: 가게/브랜드 정보 */}
      <div className={styles.group}>
        <div className={styles.groupLabel}>가게/브랜드 정보</div>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>가게 이름</span>
          <input
            type="text"
            className={styles.input}
            value={form.store_name}
            onChange={(e) => update('store_name', e.target.value)}
            placeholder="예: 리부트 웨딩컨설팅"
            maxLength={100}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>슬로건</span>
          <input
            type="text"
            className={styles.input}
            value={form.slogan}
            onChange={(e) => update('slogan', e.target.value)}
            placeholder="예: 19년차의 경험으로, 당신의 하루를"
            maxLength={200}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>업종</span>
          <select
            className={styles.select}
            value={form.industry}
            onChange={(e) => update('industry', e.target.value)}
          >
            <option value="">선택 안 함</option>
            {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
        </label>
      </div>

      {/* 그룹 2: 비주얼 */}
      <div className={styles.group}>
        <div className={styles.groupLabel}>비주얼</div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>로고 이미지</span>
          <div className={styles.logoArea}>
            {form.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={form.logo_url} alt="로고" className={styles.logoPreview} />
            ) : (
              <div className={styles.logoPlaceholder}>로고<br />없음</div>
            )}
            <div className={styles.logoControls}>
              <input
                type="file"
                id="brand-logo-upload"
                accept="image/jpeg,image/png"
                onChange={handleLogoChange}
                style={{ display: 'none' }}
              />
              <label htmlFor="brand-logo-upload" className={styles.logoBtn}>
                {logoUploading ? '업로드 중...' : (form.logo_url ? '교체' : '+ 로고 업로드')}
              </label>
              {form.logo_url && (
                <button type="button" className={styles.logoRemoveBtn} onClick={removeLogo}>
                  로고 제거
                </button>
              )}
              <div className={styles.logoHint}>JPG/PNG, 최대 2MB. 정사각형 권장</div>
            </div>
          </div>
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>브랜드 컬러</span>
          <div className={styles.colorRow}>
            <div className={styles.colorField}>
              <div className={styles.colorBox}>
                <input
                  type="color"
                  className={styles.colorSwatch}
                  value={form.primary_color || '#FF5F1F'}
                  onChange={(e) => update('primary_color', e.target.value.toUpperCase())}
                  aria-label="메인 컬러"
                />
                <input
                  type="text"
                  className={styles.colorHex}
                  value={form.primary_color}
                  onChange={(e) => {
                    const v = e.target.value.toUpperCase();
                    if (v === '' || /^#[0-9A-F]{0,6}$/.test(v)) update('primary_color', v);
                  }}
                  placeholder="#FF5F1F"
                  maxLength={7}
                />
              </div>
              <div className={styles.logoHint}>메인 (자막·강조)</div>
            </div>
            <div className={styles.colorField}>
              <div className={styles.colorBox}>
                <input
                  type="color"
                  className={styles.colorSwatch}
                  value={form.secondary_color || '#1F2937'}
                  onChange={(e) => update('secondary_color', e.target.value.toUpperCase())}
                  aria-label="서브 컬러"
                />
                <input
                  type="text"
                  className={styles.colorHex}
                  value={form.secondary_color}
                  onChange={(e) => {
                    const v = e.target.value.toUpperCase();
                    if (v === '' || /^#[0-9A-F]{0,6}$/.test(v)) update('secondary_color', v);
                  }}
                  placeholder="#1F2937"
                  maxLength={7}
                />
              </div>
              <div className={styles.logoHint}>서브 (보조 그래픽)</div>
            </div>
          </div>
        </div>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>추천 폰트</span>
          <select
            className={styles.select}
            value={form.font_family}
            onChange={(e) => update('font_family', e.target.value)}
          >
            <option value="">기본(Noto Sans KR)</option>
            {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
      </div>

      {/* 그룹 3: 시그니처 멘트 */}
      <div className={styles.group}>
        <div className={styles.groupLabel}>시그니처 멘트</div>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>시그니처 인사</span>
          <input
            type="text"
            className={styles.input}
            value={form.signature_intro}
            onChange={(e) => update('signature_intro', e.target.value)}
            placeholder='예: "안녕하세요 리부트 대표 공은희입니다"'
            maxLength={500}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>시그니처 클로징</span>
          <input
            type="text"
            className={styles.input}
            value={form.signature_outro}
            onChange={(e) => update('signature_outro', e.target.value)}
            placeholder='예: "더 궁금한 건 프로필에서"'
            maxLength={500}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>단골 CTA</span>
          <input
            type="text"
            className={styles.input}
            value={form.default_cta}
            onChange={(e) => update('default_cta', e.target.value)}
            placeholder='예: "예약 문의는 DM으로 남겨주세요"'
            maxLength={300}
          />
        </label>
      </div>

      {/* 그룹 4: 연락처 */}
      <div className={styles.group}>
        <div className={styles.groupLabel}>연락처 (캡션 자동 삽입)</div>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>위치</span>
          <input
            type="text"
            className={styles.input}
            value={form.location}
            onChange={(e) => update('location', e.target.value)}
            placeholder="예: 서울 강남구 역삼동"
            maxLength={200}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>영업시간</span>
          <input
            type="text"
            className={styles.input}
            value={form.business_hours}
            onChange={(e) => update('business_hours', e.target.value)}
            placeholder="예: 평일 10~20시 / 주말 11~18시"
            maxLength={200}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>전화번호</span>
          <input
            type="tel"
            className={styles.input}
            value={form.phone}
            onChange={(e) => update('phone', e.target.value)}
            placeholder="예: 010-1234-5678"
            maxLength={30}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>인스타그램</span>
          <div className={styles.inputPrefix}>
            <span className={styles.prefixAt}>@</span>
            <input
              type="text"
              className={styles.input}
              value={form.instagram}
              onChange={(e) => update('instagram', e.target.value.replace(/^@/, ''))}
              placeholder="예: reboot_wedding"
              maxLength={50}
            />
          </div>
        </label>
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.saveBtn}
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? '저장 중...' : '브랜드 킷 저장'}
        </button>
        {!isEmpty && (
          <button
            type="button"
            className={styles.deleteBtn}
            onClick={handleDelete}
            disabled={saving}
          >
            삭제
          </button>
        )}
      </div>
    </div>
  );
}
