// app.js — Boot sequence and event wiring

import * as storage from './storage.js';
import { initChat } from './chat.js';
import { renderHealthSidebar, renderGoalsPanel, renderSettingsPanel, initPanelTabs, showToast } from './ui.js';
import { showOnboarding } from './onboarding.js';
import { initReminders } from './reminders.js';

// ── Boot ─────────────────────────────────────────────────────────────────────

async function boot() {
  // Render panels immediately with available data
  renderHealthSidebar();
  renderGoalsPanel();

  // Wire up panel navigation
  initPanelTabs();
  wireNavigation();

  // Check if onboarding is needed
  if (!storage.isOnboardingComplete()) {
    showOnboarding(() => {
      // After onboarding, refresh everything and start chat
      renderHealthSidebar();
      renderGoalsPanel();
      initChat();
    });
  } else {
    // Init reminders in background
    initReminders().catch(() => {});

    // Start chat
    initChat();
  }

  // Listen for data changes from outside (reminders, storage events)
  window.addEventListener('vita:taskCompleted', () => {
    renderGoalsPanel();
  });

  // Periodic sidebar refresh (in case vitals are added)
  setInterval(() => {
    renderHealthSidebar();
    renderGoalsPanel();
  }, 30_000);
}

// ── Navigation ───────────────────────────────────────────────────────────────

function wireNavigation() {
  // Header panel toggles (desktop)
  document.getElementById('btn-show-record')?.addEventListener('click', () => {
    toggleSidePanel('health-sidebar-panel');
  });

  document.getElementById('btn-show-goals')?.addEventListener('click', () => {
    toggleSidePanel('goals-panel-wrapper');
  });

  document.getElementById('btn-show-settings')?.addEventListener('click', () => {
    renderSettingsPanel();
    toggleSidePanel('settings-panel-wrapper');
  });

  // Mobile bottom nav
  document.querySelectorAll('[data-mobile-nav]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.mobileNav;
      document.querySelectorAll('.mobile-panel').forEach((p) => {
        p.classList.toggle('mobile-panel--visible', p.id === target);
      });
      document.querySelectorAll('[data-mobile-nav]').forEach((b) => {
        b.classList.toggle('nav-btn--active', b.dataset.mobileNav === target);
      });
    });
  });

  // Close modals on backdrop click
  document.getElementById('onboarding-modal')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      // Don't close during first-run; only allow if API key is set
      if (storage.isOnboardingComplete()) {
        e.currentTarget.classList.add('hidden');
      }
    }
  });
}

function toggleSidePanel(id) {
  const panel = document.getElementById(id);
  if (!panel) return;
  const isOpen = panel.classList.contains('side-panel--open');

  // Only close panels on the same side (left vs right)
  const isRight = panel.classList.contains('side-panel--right');
  document.querySelectorAll(isRight ? '.side-panel--right' : '.side-panel:not(.side-panel--right)')
    .forEach((p) => p.classList.remove('side-panel--open'));

  if (!isOpen) panel.classList.add('side-panel--open');
}

// ── Start ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', boot);
