// onboarding.js — 3-step first-run flow

import * as storage from './storage.js';
import { validateApiKey, ApiError } from './api.js';
import { requestNotificationPermission, initReminders } from './reminders.js';

// ── Entry Point ──────────────────────────────────────────────────────────────

export function showOnboarding(onComplete) {
  const modal = document.getElementById('onboarding-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  showStep(1, onComplete);
}

export function hideOnboarding() {
  const modal = document.getElementById('onboarding-modal');
  if (modal) modal.classList.add('hidden');
}

// ── Step Navigation ──────────────────────────────────────────────────────────

function showStep(step, onComplete) {
  document.querySelectorAll('.onboarding-step').forEach((el) => {
    el.classList.toggle('onboarding-step--active', el.dataset.step === String(step));
  });

  updateStepIndicator(step);
  wireStep(step, onComplete);
}

function updateStepIndicator(step) {
  document.querySelectorAll('.step-dot').forEach((dot, i) => {
    dot.classList.toggle('step-dot--active', i + 1 === step);
    dot.classList.toggle('step-dot--done', i + 1 < step);
  });
}

// ── Step Wiring ──────────────────────────────────────────────────────────────

function wireStep(step, onComplete) {
  if (step === 1) {
    document.getElementById('btn-start')?.addEventListener('click', () => showStep(2, onComplete), { once: true });
  }

  if (step === 2) {
    document.getElementById('btn-verify-key')?.addEventListener('click', () => handleApiKeyStep(onComplete), { once: true });
    document.getElementById('btn-get-api-key')?.addEventListener('click', () => {
      window.open('https://console.anthropic.com/keys', '_blank');
    }, { once: true });

    // Allow Enter key in API key input
    document.getElementById('onboarding-api-key')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleApiKeyStep(onComplete);
    });
  }

  if (step === 3) {
    document.getElementById('btn-save-profile')?.addEventListener('click', () => handleProfileStep(onComplete), { once: true });
    document.getElementById('btn-skip-profile')?.addEventListener('click', () => completeOnboarding(onComplete), { once: true });

    // Live unit toggle
    document.getElementById('profile-units')?.addEventListener('change', (e) => {
      const heightUnit = document.getElementById('height-unit');
      const weightUnit = document.getElementById('weight-unit');
      if (e.target.value === 'imperial') {
        if (heightUnit) heightUnit.textContent = 'ft';
        if (weightUnit) weightUnit.textContent = 'lbs';
      } else {
        if (heightUnit) heightUnit.textContent = 'cm';
        if (weightUnit) weightUnit.textContent = 'kg';
      }
    });
  }
}

// ── Step 2: API Key ──────────────────────────────────────────────────────────

async function handleApiKeyStep(onComplete) {
  const input = document.getElementById('onboarding-api-key');
  const btn = document.getElementById('btn-verify-key');
  const error = document.getElementById('api-key-error');

  if (!input || !btn) return;

  const apiKey = input.value.trim();
  if (!apiKey) {
    showFieldError(error, 'Please enter your API key.');
    return;
  }
  if (!apiKey.startsWith('sk-ant-')) {
    showFieldError(error, 'API keys start with "sk-ant-". Double-check your key.');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Verifying...';
  clearFieldError(error);

  try {
    await validateApiKey(apiKey);
    storage.saveConfig({ apiKey, model: 'claude-opus-4-6' });
    showStep(3, onComplete);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      showFieldError(error, 'Invalid API key. Please check and try again.');
    } else {
      showFieldError(error, `Connection error: ${e.message}`);
    }
    btn.disabled = false;
    btn.textContent = 'Verify & Continue';
  }
}

// ── Step 3: Profile ──────────────────────────────────────────────────────────

async function handleProfileStep(onComplete) {
  const getName = (id) => document.getElementById(id)?.value?.trim() || null;
  const getVal = (id) => {
    const v = document.getElementById(id)?.value?.trim();
    return v || null;
  };

  const name = getName('profile-name');
  const dob = getVal('profile-dob');
  const sex = getVal('profile-sex');
  const heightVal = getVal('profile-height');
  const weightVal = getVal('profile-weight');
  const units = getVal('profile-units') || 'metric';

  const record = storage.getHealthRecord();

  if (name) record.demographics.name = name;
  if (dob) record.demographics.dateOfBirth = dob;
  if (sex) record.demographics.biologicalSex = sex;

  if (heightVal) {
    const value = parseFloat(heightVal);
    if (!isNaN(value)) {
      record.demographics.height = { value, unit: units === 'metric' ? 'cm' : 'ft' };
    }
  }

  if (weightVal) {
    const value = parseFloat(weightVal);
    if (!isNaN(value)) {
      const unit = units === 'metric' ? 'kg' : 'lbs';
      record.vitals.weight.push({ value, unit, recordedAt: new Date().toISOString() });
    }
  }

  record.preferences.unitsSystem = units;
  storage.saveHealthRecord(record);

  await completeOnboarding(onComplete);
}

async function completeOnboarding(onComplete) {
  storage.saveConfig({ onboardingComplete: true });

  // Request notification permission
  try {
    const perm = await requestNotificationPermission();
    if (perm === 'granted') {
      await initReminders();
    }
  } catch {
    // Non-fatal
  }

  hideOnboarding();
  onComplete?.();
}

// ── Error Helpers ────────────────────────────────────────────────────────────

function showFieldError(el, msg) {
  if (el) {
    el.textContent = msg;
    el.classList.remove('hidden');
  }
}

function clearFieldError(el) {
  if (el) {
    el.textContent = '';
    el.classList.add('hidden');
  }
}
