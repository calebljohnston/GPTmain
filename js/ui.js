// ui.js — Panel rendering and DOM helpers

import * as storage from './storage.js';
import { formatVitalDisplay, formatAge, formatHeight, getLatestVital } from './health-record.js';
import { computeGoalProgress, computeTaskStreaks, isCompletedToday, getDaysUntilTarget } from './goals.js';
import { getUpcomingReminders } from './reminders.js';

// ── Health Record Sidebar ────────────────────────────────────────────────────

export function renderHealthSidebar() {
  const record = storage.getHealthRecord();
  const sidebar = document.getElementById('health-sidebar');
  if (!sidebar) return;

  const age = formatAge(record.demographics?.dateOfBirth);
  const name = record.demographics?.name;

  sidebar.innerHTML = `
    <div class="sidebar-header">
      <div class="avatar">${name ? name[0].toUpperCase() : '?'}</div>
      <div class="profile-info">
        <div class="profile-name">${name || 'Your Profile'}</div>
        <div class="profile-meta">${[
          age ? `${age} years` : null,
          record.demographics?.biologicalSex,
          record.demographics?.bloodType,
        ]
          .filter(Boolean)
          .join(' · ') || 'No profile yet'}</div>
      </div>
    </div>

    <section class="sidebar-section">
      <h3 class="section-title">Latest Vitals</h3>
      ${renderVitals(record)}
    </section>

    ${
      record.conditions.length > 0
        ? `<section class="sidebar-section">
        <h3 class="section-title">Conditions</h3>
        <ul class="tag-list">
          ${record.conditions
            .filter((c) => c.status === 'active')
            .map((c) => `<li class="tag tag--condition">${escHtml(c.name)}</li>`)
            .join('')}
        </ul>
      </section>`
        : ''
    }

    ${
      record.medications.length > 0
        ? `<section class="sidebar-section">
        <h3 class="section-title">Medications</h3>
        <ul class="med-list">
          ${record.medications
            .filter((m) => m.active)
            .map(
              (m) => `<li class="med-item">
              <span class="med-name">${escHtml(m.name)}</span>
              <span class="med-detail">${escHtml(m.dosage || '')} ${escHtml(m.frequency || '')}</span>
            </li>`
            )
            .join('')}
        </ul>
      </section>`
        : ''
    }

    ${
      record.allergies.length > 0
        ? `<section class="sidebar-section">
        <h3 class="section-title">Allergies</h3>
        <ul class="tag-list">
          ${record.allergies
            .map(
              (a) =>
                `<li class="tag tag--allergy" title="${escHtml(a.reaction || '')}">${escHtml(a.substance)}${a.severity === 'severe' ? ' ⚠️' : ''}</li>`
            )
            .join('')}
        </ul>
      </section>`
        : ''
    }

    <div class="sidebar-actions">
      <button class="btn-text" id="btn-export-data">Export Data</button>
      <button class="btn-text btn-danger" id="btn-clear-data">Clear All Data</button>
    </div>
  `;

  document.getElementById('btn-export-data')?.addEventListener('click', exportData);
  document.getElementById('btn-clear-data')?.addEventListener('click', confirmClearData);
}

function renderVitals(record) {
  const vitals = [
    { key: 'weight', label: 'Weight', icon: '⚖️' },
    { key: 'bloodPressure', label: 'Blood Pressure', icon: '❤️' },
    { key: 'restingHeartRate', label: 'Heart Rate', icon: '💓' },
    { key: 'sleepHours', label: 'Sleep', icon: '🌙' },
    { key: 'bloodGlucose', label: 'Blood Glucose', icon: '🩸' },
  ];

  const items = vitals
    .map(({ key, label, icon }) => {
      const entries = record.vitals?.[key];
      const latest = entries && entries.length > 0 ? entries[entries.length - 1] : null;
      const value = latest ? formatVitalDisplay(key, latest) : '—';
      const date = latest ? formatRelativeDate(latest.recordedAt) : '';
      return `<div class="vital-row">
      <span class="vital-icon">${icon}</span>
      <div class="vital-info">
        <span class="vital-label">${label}</span>
        <span class="vital-value">${value}</span>
      </div>
      ${date ? `<span class="vital-date">${date}</span>` : ''}
    </div>`;
    })
    .join('');

  return items || '<p class="empty-state">No vitals recorded yet. Tell Vita about your health!</p>';
}

// ── Goals Panel ──────────────────────────────────────────────────────────────

export function renderGoalsPanel() {
  const goalsData = storage.getGoals();
  const panel = document.getElementById('goals-panel');
  if (!panel) return;

  const activeGoals = goalsData.goals.filter((g) => g.status === 'active');
  const tasks = computeTaskStreaks(goalsData.tasks.filter((t) => t.active));
  const reminders = getUpcomingReminders(4);

  panel.innerHTML = `
    ${
      activeGoals.length > 0
        ? `<section class="panel-section">
        <h3 class="section-title">Active Goals</h3>
        ${activeGoals.map(renderGoalCard).join('')}
      </section>`
        : `<section class="panel-section">
        <h3 class="section-title">Goals</h3>
        <p class="empty-state">No active goals yet.<br>Tell Vita what you'd like to achieve!</p>
      </section>`
    }

    ${
      tasks.length > 0
        ? `<section class="panel-section">
        <h3 class="section-title">Today's Tasks</h3>
        <ul class="task-list">
          ${tasks.map(renderTaskItem).join('')}
        </ul>
      </section>`
        : ''
    }

    ${
      reminders.length > 0
        ? `<section class="panel-section">
        <h3 class="section-title">Reminders Today</h3>
        <ul class="reminder-list">
          ${reminders.map(renderReminderItem).join('')}
        </ul>
      </section>`
        : ''
    }
  `;

  // Attach task complete handlers
  panel.querySelectorAll('.task-checkbox').forEach((cb) => {
    cb.addEventListener('change', handleTaskCheckbox);
  });
}

function renderGoalCard(goal) {
  const progress = computeGoalProgress(goal);
  const daysLeft = getDaysUntilTarget(goal.targetDate);
  const categoryIcons = {
    weight: '⚖️', fitness: '🏃', nutrition: '🥗', sleep: '🌙',
    mental_health: '🧘', medication: '💊', lab_values: '🔬', custom: '🎯',
  };

  const milestonesCompleted = goal.milestones?.filter((m) => m.completed).length || 0;
  const milestonesTotal = goal.milestones?.length || 0;

  return `<div class="goal-card">
    <div class="goal-header">
      <span class="goal-icon">${categoryIcons[goal.category] || '🎯'}</span>
      <div class="goal-info">
        <div class="goal-title">${escHtml(goal.title)}</div>
        ${daysLeft !== null ? `<div class="goal-deadline">${daysLeft > 0 ? `${daysLeft}d left` : daysLeft === 0 ? 'Due today!' : `${Math.abs(daysLeft)}d overdue`}</div>` : ''}
      </div>
    </div>
    ${
      progress
        ? `<div class="progress-bar-container">
        <div class="progress-bar" style="width: ${progress.percentage}%"></div>
      </div>
      <div class="progress-label">${progress.current} → ${progress.target} ${progress.unit || ''} (${progress.percentage}%)</div>`
        : ''
    }
    ${
      milestonesTotal > 0
        ? `<div class="milestones-indicator">${milestonesCompleted}/${milestonesTotal} milestones</div>`
        : ''
    }
  </div>`;
}

function renderTaskItem(task) {
  const completedToday = isCompletedToday(task);
  const streak = task.streak || 0;

  return `<li class="task-item ${completedToday ? 'task-item--done' : ''}">
    <label class="task-label">
      <input type="checkbox" class="task-checkbox" data-task-id="${task.id}" ${completedToday ? 'checked' : ''}>
      <span class="task-title">${escHtml(task.title)}</span>
    </label>
    ${task.dueTime ? `<span class="task-time">${task.dueTime}</span>` : ''}
    ${streak > 1 ? `<span class="streak-badge">🔥 ${streak}</span>` : ''}
  </li>`;
}

function renderReminderItem(reminder) {
  return `<li class="reminder-item ${reminder.isPast ? 'reminder-item--past' : ''}">
    <span class="reminder-time">${reminder.scheduledTime}</span>
    <span class="reminder-title">${escHtml(reminder.title)}</span>
  </li>`;
}

// ── Task Completion ──────────────────────────────────────────────────────────

function handleTaskCheckbox(e) {
  const taskId = e.target.dataset.taskId;
  const checked = e.target.checked;
  if (checked) {
    storage.markTaskComplete(taskId);
    renderGoalsPanel();

    // Dispatch event for chat to acknowledge
    window.dispatchEvent(new CustomEvent('vita:taskCompleted', { detail: { taskId } }));
  }
}

// ── Export / Clear ───────────────────────────────────────────────────────────

function exportData() {
  const json = storage.exportData();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `vita-health-data-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function confirmClearData() {
  if (confirm('Are you sure you want to clear ALL health data? This cannot be undone.')) {
    storage.clearAllData();
    window.location.reload();
  }
}

// ── Toast Notifications ──────────────────────────────────────────────────────

export function showToast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container') || createToastContainer();
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast--exit');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function createToastContainer() {
  const el = document.createElement('div');
  el.id = 'toast-container';
  document.body.appendChild(el);
  return el;
}

// ── Panel Tab Switching (mobile) ─────────────────────────────────────────────

export function initPanelTabs() {
  const tabs = document.querySelectorAll('[data-panel-tab]');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.panelTab;
      // Desktop panels: toggle visibility
      document.querySelectorAll('.panel-sidebar').forEach((p) => {
        p.classList.toggle('panel-sidebar--active', p.id === target);
      });
      tabs.forEach((t) => t.classList.toggle('nav-tab--active', t.dataset.panelTab === target));
    });
  });
}

// ── Settings Panel ───────────────────────────────────────────────────────────

export function renderSettingsPanel() {
  const config = storage.getConfig() || {};
  const panel = document.getElementById('settings-panel');
  if (!panel) return;

  panel.innerHTML = `
    <div class="settings-section">
      <h3>API Configuration</h3>
      <div class="form-group">
        <label>Anthropic API Key</label>
        <div class="api-key-row">
          <input type="password" id="settings-api-key" value="${escHtml(config.apiKey || '')}" placeholder="sk-ant-..." class="input-field">
          <button class="btn-primary btn-sm" id="btn-save-api-key">Save</button>
        </div>
      </div>
      <div class="form-group">
        <label>Model</label>
        <select id="settings-model" class="input-field">
          <option value="claude-opus-4-6" ${config.model === 'claude-opus-4-6' ? 'selected' : ''}>Claude Opus 4.6 (Best)</option>
          <option value="claude-sonnet-4-6" ${config.model === 'claude-sonnet-4-6' ? 'selected' : ''}>Claude Sonnet 4.6 (Faster)</option>
          <option value="claude-haiku-4-5-20251001" ${config.model === 'claude-haiku-4-5-20251001' ? 'selected' : ''}>Claude Haiku (Cheapest)</option>
        </select>
      </div>
    </div>
    <div class="settings-section">
      <h3>Privacy</h3>
      <p class="settings-note">All your health data is stored locally in your browser's localStorage. It never leaves your device except when sent to Anthropic's API for AI responses.</p>
      <button class="btn-outline" id="btn-export-settings">Export Health Data</button>
    </div>
  `;

  document.getElementById('btn-save-api-key')?.addEventListener('click', () => {
    const key = document.getElementById('settings-api-key').value.trim();
    const model = document.getElementById('settings-model').value;
    if (key) {
      storage.saveConfig({ apiKey: key, model });
      showToast('Settings saved!', 'success');
    }
  });

  document.getElementById('btn-export-settings')?.addEventListener('click', exportData);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatRelativeDate(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  const now = new Date();
  const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export { escHtml };
