// Copyright 2024 VoteChain Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * CreateProposalForm — issue #326
 *
 * Controlled form for creating a governance proposal.  All field constraints
 * mirror the on-chain contract validation:
 *
 *   title       : 1–128 characters
 *   description : 1–1024 characters
 *   quorum      : integer > 0
 *   duration    : integer 60–2,592,000 seconds (1 minute – 30 days)
 *
 * The form POSTs to `POST /api/proposals`.  If the backend endpoint does not
 * exist yet the component handles the error gracefully and shows a user-facing
 * message — it never crashes.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

// ── Types ────────────────────────────────────────────────────────────────────

export interface CreateProposalPayload {
  title: string;
  description: string;
  quorum: number;
  duration: number;
}

export interface CreateProposalFormProps {
  /** Called with the new proposal ID when the submission succeeds. */
  onSuccess?: (proposalId: string) => void;
  /** Called when the user clicks "Cancel". */
  onCancel?: () => void;
}

// ── Validation helpers ────────────────────────────────────────────────────────

const TITLE_MAX = 128;
const DESCRIPTION_MAX = 1024;
const DURATION_MIN = 60;
const DURATION_MAX = 2_592_000; // 30 days in seconds

interface FormErrors {
  title?: string;
  description?: string;
  quorum?: string;
  duration?: string;
}

function validateForm(
  title: string,
  description: string,
  quorum: string,
  duration: string,
  t: (key: string, opts?: Record<string, unknown>) => string,
): FormErrors {
  const errors: FormErrors = {};

  if (!title.trim()) {
    errors.title = t('createProposal.validation.titleRequired');
  } else if (title.length > TITLE_MAX) {
    errors.title = t('createProposal.validation.titleMax', { max: TITLE_MAX });
  }

  if (!description.trim()) {
    errors.description = t('createProposal.validation.descriptionRequired');
  } else if (description.length > DESCRIPTION_MAX) {
    errors.description = t('createProposal.validation.descriptionMax', { max: DESCRIPTION_MAX });
  }

  const quorumNum = Number(quorum);
  if (!quorum.trim() || Number.isNaN(quorumNum)) {
    errors.quorum = t('createProposal.validation.quorumRequired');
  } else if (!Number.isInteger(quorumNum) || quorumNum <= 0) {
    errors.quorum = t('createProposal.validation.quorumPositive');
  }

  const durationNum = Number(duration);
  if (!duration.trim() || Number.isNaN(durationNum)) {
    errors.duration = t('createProposal.validation.durationRequired');
  } else if (!Number.isInteger(durationNum) || durationNum < DURATION_MIN || durationNum > DURATION_MAX) {
    errors.duration = t('createProposal.validation.durationRange', {
      min: DURATION_MIN,
      max: DURATION_MAX,
    });
  }

  return errors;
}

// ── Duration preset helper ────────────────────────────────────────────────────

const DURATION_PRESETS: { label: string; seconds: number }[] = [
  { label: '1 day',   seconds: 86_400 },
  { label: '3 days',  seconds: 259_200 },
  { label: '7 days',  seconds: 604_800 },
  { label: '14 days', seconds: 1_209_600 },
  { label: '30 days', seconds: 2_592_000 },
];

// ── Component ─────────────────────────────────────────────────────────────────

export function CreateProposalForm({ onSuccess, onCancel }: CreateProposalFormProps) {
  const { t } = useTranslation();

  // Form field state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [quorum, setQuorum] = useState('');
  const [duration, setDuration] = useState('');

  // UI state
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [reviewing, setReviewing] = useState(false);

  // ── Field blur handler (inline validation) ────────────────────────────────

  function handleBlur(field: string) {
    setTouched((prev) => ({ ...prev, [field]: true }));
    const fieldErrors = validateForm(title, description, quorum, duration, t);
    setErrors(fieldErrors);
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitError(null);

    // Mark all fields as touched so errors show up
    setTouched({ title: true, description: true, quorum: true, duration: true });

    const fieldErrors = validateForm(title, description, quorum, duration, t);
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) return;

    setReviewing(true);
  }

  async function handleConfirm() {
    setSubmitError(null);

    const payload: CreateProposalPayload = {
      title: title.trim(),
      description: description.trim(),
      quorum: Number(quorum),
      duration: Number(duration),
    };

    setSubmitting(true);
    try {
      const res = await fetch('/api/proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ??
            t('createProposal.submitError', { status: res.status }),
        );
      }

      const data = await res.json();
      const proposalId: string = String(
        (data as { id?: string | number }).id ?? (data as { proposal_id?: string | number }).proposal_id ?? '',
      );
      onSuccess?.(proposalId);
    } catch (err: unknown) {
      const msg =
        (err as { message?: string })?.message ??
        t('createProposal.submitErrorGeneric');
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  const hasError = (field: keyof FormErrors) =>
    touched[field] && Boolean(errors[field]);

  const errorId = (field: string) => `create-proposal-${field}-error`;
  const inputId  = (field: string) => `create-proposal-${field}`;

  if (reviewing) {
    return (
      <form
        onSubmit={(e) => e.preventDefault()}
        aria-label={t('createProposal.reviewFormLabel')}
        style={styles.form}
      >
        <h2 style={styles.heading}>{t('createProposal.reviewHeading')}</h2>
        {submitError && (
          <div role="alert" style={styles.globalError}>
            {submitError}
          </div>
        )}
        <dl style={styles.reviewList}>
          <div style={styles.reviewRow}>
            <dt style={styles.reviewLabel}>{t('createProposal.titleLabel')}</dt>
            <dd style={styles.reviewValue}>{title.trim()}</dd>
          </div>
          <div style={styles.reviewRow}>
            <dt style={styles.reviewLabel}>{t('createProposal.descriptionLabel')}</dt>
            <dd style={styles.reviewValue}>{description.trim()}</dd>
          </div>
          <div style={styles.reviewRow}>
            <dt style={styles.reviewLabel}>{t('createProposal.quorumLabel')}</dt>
            <dd style={styles.reviewValue}>{quorum}</dd>
          </div>
          <div style={styles.reviewRow}>
            <dt style={styles.reviewLabel}>{t('createProposal.durationLabel')}</dt>
            <dd style={styles.reviewValue}>{duration}</dd>
          </div>
        </dl>
        <div style={styles.actions}>
          <button
            type="button"
            onClick={() => setReviewing(false)}
            disabled={submitting}
            style={styles.cancelBtn}
          >
            {t('createProposal.reviewBackButton')}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={submitting}
            aria-busy={submitting}
            style={styles.submitBtn}
          >
            {submitting
              ? t('createProposal.submittingButton')
              : t('createProposal.reviewConfirmButton')}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-label={t('createProposal.formLabel')}
      style={styles.form}
    >
      <h2 style={styles.heading}>{t('createProposal.heading')}</h2>

      {/* ── Global submit error ── */}
      {submitError && (
        <div role="alert" style={styles.globalError}>
          {submitError}
        </div>
      )}

      {/* ── Title ── */}
      <div style={styles.fieldGroup}>
        <label htmlFor={inputId('title')} style={styles.label}>
          {t('createProposal.titleLabel')}
          <span style={styles.required} aria-hidden="true"> *</span>
        </label>
        <input
          id={inputId('title')}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => handleBlur('title')}
          maxLength={TITLE_MAX}
          required
          aria-required="true"
          aria-describedby={hasError('title') ? errorId('title') : `${inputId('title')}-hint`}
          aria-invalid={hasError('title')}
          style={{ ...styles.input, ...(hasError('title') ? styles.inputError : {}) }}
          disabled={submitting}
          placeholder={t('createProposal.titlePlaceholder')}
        />
        <span id={`${inputId('title')}-hint`} style={styles.hint}>
          {title.length}/{TITLE_MAX}
        </span>
        {hasError('title') && (
          <span id={errorId('title')} role="alert" style={styles.fieldError}>
            {errors.title}
          </span>
        )}
      </div>

      {/* ── Description ── */}
      <div style={styles.fieldGroup}>
        <label htmlFor={inputId('description')} style={styles.label}>
          {t('createProposal.descriptionLabel')}
          <span style={styles.required} aria-hidden="true"> *</span>
        </label>
        <textarea
          id={inputId('description')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => handleBlur('description')}
          maxLength={DESCRIPTION_MAX}
          rows={6}
          required
          aria-required="true"
          aria-describedby={
            hasError('description') ? errorId('description') : `${inputId('description')}-hint`
          }
          aria-invalid={hasError('description')}
          style={{ ...styles.textarea, ...(hasError('description') ? styles.inputError : {}) }}
          disabled={submitting}
          placeholder={t('createProposal.descriptionPlaceholder')}
        />
        <span id={`${inputId('description')}-hint`} style={styles.hint}>
          {description.length}/{DESCRIPTION_MAX}
        </span>
        {hasError('description') && (
          <span id={errorId('description')} role="alert" style={styles.fieldError}>
            {errors.description}
          </span>
        )}
      </div>

      {/* ── Quorum ── */}
      <div style={styles.fieldGroup}>
        <label htmlFor={inputId('quorum')} style={styles.label}>
          {t('createProposal.quorumLabel')}
          <span style={styles.required} aria-hidden="true"> *</span>
        </label>
        <input
          id={inputId('quorum')}
          type="number"
          min={1}
          step={1}
          value={quorum}
          onChange={(e) => setQuorum(e.target.value)}
          onBlur={() => handleBlur('quorum')}
          required
          aria-required="true"
          aria-describedby={
            hasError('quorum')
              ? errorId('quorum')
              : `${inputId('quorum')}-hint`
          }
          aria-invalid={hasError('quorum')}
          style={{ ...styles.input, ...(hasError('quorum') ? styles.inputError : {}) }}
          disabled={submitting}
          placeholder={t('createProposal.quorumPlaceholder')}
        />
        <span id={`${inputId('quorum')}-hint`} style={styles.hint}>
          {t('createProposal.quorumHint')}
        </span>
        {hasError('quorum') && (
          <span id={errorId('quorum')} role="alert" style={styles.fieldError}>
            {errors.quorum}
          </span>
        )}
      </div>

      {/* ── Duration ── */}
      <div style={styles.fieldGroup}>
        <label htmlFor={inputId('duration')} style={styles.label}>
          {t('createProposal.durationLabel')}
          <span style={styles.required} aria-hidden="true"> *</span>
        </label>

        {/* Quick-pick preset buttons */}
        <div style={styles.presets} role="group" aria-label={t('createProposal.durationPresets')}>
          {DURATION_PRESETS.map((p) => (
            <button
              key={p.seconds}
              type="button"
              onClick={() => setDuration(String(p.seconds))}
              style={{
                ...styles.presetBtn,
                ...(duration === String(p.seconds) ? styles.presetBtnActive : {}),
              }}
              aria-pressed={duration === String(p.seconds)}
              disabled={submitting}
            >
              {p.label}
            </button>
          ))}
        </div>

        <input
          id={inputId('duration')}
          type="number"
          min={DURATION_MIN}
          max={DURATION_MAX}
          step={1}
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
          onBlur={() => handleBlur('duration')}
          required
          aria-required="true"
          aria-describedby={
            hasError('duration')
              ? errorId('duration')
              : `${inputId('duration')}-hint`
          }
          aria-invalid={hasError('duration')}
          style={{ ...styles.input, ...(hasError('duration') ? styles.inputError : {}) }}
          disabled={submitting}
          placeholder={t('createProposal.durationPlaceholder')}
        />
        <span id={`${inputId('duration')}-hint`} style={styles.hint}>
          {t('createProposal.durationHint', { min: DURATION_MIN, max: DURATION_MAX })}
        </span>
        {hasError('duration') && (
          <span id={errorId('duration')} role="alert" style={styles.fieldError}>
            {errors.duration}
          </span>
        )}
      </div>

      {/* ── Actions ── */}
      <div style={styles.actions}>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            style={styles.cancelBtn}
          >
            {t('createProposal.cancelButton')}
          </button>
        )}
        <button
          type="submit"
          disabled={submitting}
          aria-busy={submitting}
          style={styles.submitBtn}
        >
          {submitting
            ? t('createProposal.submittingButton')
            : t('createProposal.submitButton')}
        </button>
      </div>
    </form>
  );
}

// ── Inline styles ─────────────────────────────────────────────────────────────
// Kept inline to avoid adding a new CSS file dependency on this branch.
// These follow the dark-theme palette used throughout the app.

const styles: Record<string, React.CSSProperties> = {
  form: {
    maxWidth: 640,
    margin: '0 auto',
    padding: 24,
    background: '#1e1e1e',
    borderRadius: 8,
    border: '1px solid #333',
    fontFamily: 'sans-serif',
    color: '#e0e0e0',
  },
  heading: {
    fontSize: 22,
    fontWeight: 700,
    marginBottom: 24,
    color: '#fff',
  },
  fieldGroup: {
    display: 'flex',
    flexDirection: 'column',
    marginBottom: 20,
    gap: 4,
  },
  label: {
    fontSize: 14,
    fontWeight: 600,
    color: '#ccc',
    marginBottom: 4,
  },
  required: {
    color: '#ef5350',
  },
  input: {
    background: '#121212',
    border: '1px solid #444',
    borderRadius: 4,
    color: '#e0e0e0',
    fontSize: 14,
    padding: '8px 10px',
    outline: 'none',
    transition: 'border-color 0.15s',
  },
  textarea: {
    background: '#121212',
    border: '1px solid #444',
    borderRadius: 4,
    color: '#e0e0e0',
    fontSize: 14,
    padding: '8px 10px',
    outline: 'none',
    resize: 'vertical',
    transition: 'border-color 0.15s',
    fontFamily: 'inherit',
  },
  inputError: {
    borderColor: '#ef5350',
  },
  hint: {
    fontSize: 12,
    color: '#888',
  },
  fieldError: {
    fontSize: 12,
    color: '#ef5350',
  },
  globalError: {
    background: '#3b1111',
    border: '1px solid #ef5350',
    borderRadius: 4,
    padding: '10px 14px',
    marginBottom: 20,
    fontSize: 14,
    color: '#ef9a9a',
  },
  presets: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 6,
  },
  presetBtn: {
    background: '#2a2a2a',
    border: '1px solid #444',
    borderRadius: 4,
    color: '#ccc',
    cursor: 'pointer',
    fontSize: 12,
    padding: '4px 10px',
  },
  presetBtnActive: {
    background: '#1565c0',
    borderColor: '#42a5f5',
    color: '#fff',
  },
  actions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 8,
  },
  cancelBtn: {
    background: 'transparent',
    border: '1px solid #555',
    borderRadius: 4,
    color: '#ccc',
    cursor: 'pointer',
    fontSize: 14,
    padding: '8px 20px',
  },
  submitBtn: {
    background: '#1565c0',
    border: 'none',
    borderRadius: 4,
    color: '#fff',
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 600,
    padding: '8px 24px',
  },
  reviewList: {
    margin: 0,
    marginBottom: 24,
  },
  reviewRow: {
    padding: '10px 0',
    borderBottom: '1px solid #333',
  },
  reviewLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: '#888',
    marginBottom: 4,
  },
  reviewValue: {
    margin: 0,
    fontSize: 14,
    color: '#e0e0e0',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
  },
};
