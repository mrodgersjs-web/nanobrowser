import { describe, it, expect } from 'vitest';
import { SecurityGuardrails } from '../index';

const check = SecurityGuardrails.checkSubmit.bind(SecurityGuardrails);

describe('Gate-D checkSubmit', () => {
  it('blocks bare Enter as enter-key submission', () => {
    const v = check({ enterKey: true }, false);
    expect(v).toMatchObject({ dangerous: true, blocked: true });
    expect(v.reason).toContain('enter-key submission');
  });

  it('blocks input[type=submit]', () => {
    expect(check({ tag: 'input', type: 'SUBMIT' }, false).blocked).toBe(true);
  });

  it('blocks actionable controls with transactional labels', () => {
    for (const signal of [
      { tag: 'button', text: 'Submit order' },
      { tag: 'a', text: 'Send message' },
      { tag: 'input', type: 'button', text: 'Buy now' },
      { tag: 'div', role: 'button', text: 'Checkout' },
    ]) {
      const v = check(signal, false);
      expect(v.dangerous, JSON.stringify(signal)).toBe(true);
      expect(v.blocked, JSON.stringify(signal)).toBe(true);
    }
  });

  it('lets non-transactional controls through', () => {
    for (const signal of [
      { tag: 'button', text: 'Next' },
      { tag: 'a', text: 'sender profile' }, // \bsend\b must not match "sender"
      { tag: 'input', type: 'text', text: 'Search' },
      { tag: 'span', text: 'Submit' }, // not actionable
    ]) {
      expect(check(signal, false).dangerous, JSON.stringify(signal)).toBe(false);
    }
  });

  it('arms open the gate for dangerous controls without changing danger verdict', () => {
    const armed = check({ enterKey: true }, true);
    expect(armed).toEqual({ dangerous: true, blocked: false });
  });

  it('never blocks non-dangerous controls even when disarmed', () => {
    expect(check({ tag: 'button', text: 'Cancel' }, false)).toEqual({ dangerous: false, blocked: false });
  });
});
