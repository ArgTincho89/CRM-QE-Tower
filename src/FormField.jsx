import { useEffect, useId, useRef, useState } from 'react';
import { clearFieldError, fieldErrorId, hasFieldErrors } from './formValidation.js';

/**
 * Field-level error state for a dialog form. `show(errors)` marks the fields and, after the
 * render, scrolls the first invalid control (in DOM order) into view and focuses it.
 */
export function useFieldErrors() {
  const formId = useId();
  const [errors, setErrors] = useState({});
  const [attempt, setAttempt] = useState(0);
  const formRef = useRef(null);

  useEffect(() => {
    if (attempt === 0) return;
    const target = formRef.current?.querySelector('[aria-invalid="true"]');
    if (!target) return;
    target.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    target.focus({ preventScroll: true });
  }, [attempt]);

  return {
    formRef,
    errors,
    /** Replaces the field errors; returns true when there is at least one. */
    show(next) {
      setErrors(next || {});
      const invalid = hasFieldErrors(next);
      if (invalid) setAttempt((value) => value + 1);
      return invalid;
    },
    clear(field) {
      setErrors((current) => clearFieldError(current, field));
    },
    /** ARIA wiring for the control of `field`. */
    fieldProps(field) {
      const invalid = Boolean(errors[field]);
      return { 'aria-invalid': invalid ? 'true' : undefined, 'aria-describedby': invalid ? fieldErrorId(formId, field) : undefined };
    },
    errorId(field) {
      return fieldErrorId(formId, field);
    },
  };
}

/** Error text right under a field; a polite live region so screen readers announce it. */
export function FieldError({ form, field }) {
  const message = form.errors[field] || '';
  return <span id={form.errorId(field)} className="field-error" aria-live="polite">{message}</span>;
}

/**
 * `<label class="form-field">` wrapper: label text (with " *" when required), the control
 * and hints passed as children, then the field's error text.
 */
export function FormField({ form, field, label, required = false, className = '', children }) {
  const invalid = Boolean(form.errors[field]);
  const classes = ['form-field', className, invalid ? 'has-error' : ''].filter(Boolean).join(' ');
  return <label className={classes}>
    {required ? `${label} *` : label}
    {children}
    <FieldError form={form} field={field} />
  </label>;
}
