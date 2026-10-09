"use strict";

/* =========================================================
   IELTS AI EXAMINER
   Frontend controller
========================================================= */

/* HELPERS */
const $ = (id) => document.getElementById(id);

const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function show(element) {
  if (element) element.hidden = false;
}

function hide(element) {
  if (element) element.hidden = true;
}

function setText(element, value) {
  if (element) element.textContent = value ?? "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatTime(seconds) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;

  return (
    String(minutes).padStart(2, "0") +
    ":" +
    String(remainingSeconds).padStart(2, "0")
  );
}

function getWordCount(text) {
  const cleaned = String(text || "").trim();
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).filter(Boolean).length;
}

function setButtonLoading(button, loading, text = "Processing...") {
  if (!button) return;

  if (loading) {
    if (!button.dataset.originalHtml) {
      button.dataset.originalHtml = button.innerHTML;
    }

    button.disabled = true;
    button.innerHTML = `
      <span class="loading-spinner"></span>
      <span>${escapeHtml(text)}</span>
    `;
  } else {
    button.disabled = false;

    if (button.dataset.originalHtml) {
      button.innerHTML = button.dataset.originalHtml;
      delete button.dataset.originalHtml;
    }
  }
}

async function getErrorMessage(response) {
  try {
    const data = await response.json();
    if (data && data.detail) return String(data.detail);
  } catch (error) {
    // Ignore JSON parsing errors.
  }

  return `Server error: ${response.status}`;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);

  if (!response.ok) {
    throw new Error(await getErrorMessage(response));
  }

  return response.json();
}

/* GLOBAL STATE */
const state = {
  mode: "writing",
  task: "1",
  writingTimer: null,
  writingSeconds: 20 * 60,
  questionImage: null,
  answerImage: null,
  cameraStream: null,
  cameraTarget: null,
  speakingPart: 1,
  part1Index: 0,
  part3Index: 0,
  speakingAnswers: [],
  isRecording: false,
  mediaRecorder: null,
  audioChunks: [],
  recordingStartedAt: null,
  recordingTimer: null,
  currentRecordingPart: 1,
  preparationTimer: null,
  preparationSeconds: 60,
  speakingTimer: null,
  speakingSeconds: 120,
  isEvaluatingSpeaking: false,
};

/* WRITING DATA */
const writingQuestions = {
  1: {
    minimum: 150,
    time: 20 * 60,
    defaultQuestion:
      "The chart below shows information about a topic. Summarise the information by selecting and reporting the main features, and make comparisons where relevant.",
  },
  2: {
    minimum: 250,
    time: 40 * 60,
    defaultQuestion:
      "Some people believe that education should focus mainly on practical skills, while others think that academic knowledge is more important. Discuss both views and give your own opinion.",
  },
};

/* SPEAKING DATA */
const part1Questions = [
  "Let's talk about your hometown. What do you like most about the place where you live?",
  "Do you enjoy studying English? Why or why not?",
  "What do you usually do in your free time?",
  "Do you prefer studying alone or with other people?",
  "What are your plans for the future?",
];

const part3Questions = [
  "Why do people enjoy travelling?",
  "How has technology changed the way people travel?",
  "Do you think young people travel more than previous generations?",
  "What are some advantages and disadvantages of international tourism?",
  "How can governments make tourism more sustainable?",
];

/* THEME */
function initializeTheme() {
  const themeButton = $("theme");
  if (!themeButton) return;

  const savedTheme = localStorage.getItem("ielts-theme");
  const theme = savedTheme === "dark" ? "dark" : "light";

  applyTheme(theme);

  themeButton.addEventListener("click", () => {
    const current =
      document.documentElement.dataset.theme === "dark" ? "dark" : "light";

    const next = current === "dark" ? "light" : "dark";

    applyTheme(next);
    localStorage.setItem("ielts-theme", next);
  });
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  setText($("theme-icon"), theme === "dark" ? "☾" : "☀");
  setText($("theme-text"), theme === "dark" ? "Dark" : "Light");
}

/* MODE SWITCHING */
function initializeModes() {
  document.querySelectorAll("[data-mode]").forEach((tab) => {
    tab.addEventListener("click", () => {
      switchMode(tab.dataset.mode);
    });
  });
}

function switchMode(mode) {
  const panels = {
    writing: $("writing-mode"),
    speaking: $("speaking-mode"),
    dashboard: $("dashboard-mode"),
  };

  if (!panels[mode]) {
    console.error(`Mode panel not found: ${mode}`);
    return;
  }

  document.querySelectorAll("[data-mode]").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.mode === mode);
  });

  Object.entries(panels).forEach(([name, panel]) => {
    if (panel) {
      panel.classList.toggle("active", name === mode);
    }
  });

  state.mode = mode;

  if (mode === "dashboard") {
    window.dispatchEvent(new CustomEvent("sbs:dashboard-open"));
  }
}
/* WRITING TASK SWITCH */
function initializeWritingTasks() {
  $$(".task-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const task = button.dataset.task;
      if (!task) return;
      setWritingTask(task);
    });
  });
}

function setWritingTask(task) {
  if (task !== "1" && task !== "2") return;

  state.task = task;

  $$(".task-btn").forEach((button) => {
    button.classList.toggle("active", button.dataset.task === task);
  });

  setText($("task-badge"), `Task ${task}`);

  const minimum = writingQuestions[task].minimum;
  setText($("min"), minimum);

  const question = $("question");

  if (question && !question.value.trim()) {
    question.value = writingQuestions[task].defaultQuestion;
  }

  resetWritingTimer(writingQuestions[task].time);
  updateWordCount();
}

/* WRITING TIMER */
function resetWritingTimer(seconds) {
  stopWritingTimer();
  state.writingSeconds = seconds;
  updateWritingTimerDisplay();
}

function startWritingTimer() {
  stopWritingTimer();

  state.writingTimer = setInterval(() => {
    if (state.writingSeconds <= 0) {
      stopWritingTimer();
      updateWritingTimerDisplay();
      return;
    }

    state.writingSeconds -= 1;
    updateWritingTimerDisplay();
  }, 1000);
}

function stopWritingTimer() {
  if (state.writingTimer) {
    clearInterval(state.writingTimer);
    state.writingTimer = null;
  }
}

function updateWritingTimerDisplay() {
  const timer = $("timer");
  if (!timer) return;

  setText(timer, formatTime(state.writingSeconds));

  const box = timer.closest(".timer-box");
  if (!box) return;

  box.classList.remove("warning", "danger");

  if (state.writingSeconds <= 60) {
    box.classList.add("danger");
  } else if (state.writingSeconds <= 5 * 60) {
    box.classList.add("warning");
  }
}

/* WRITING WORD COUNT */
function initializeWritingEditor() {
  const essay = $("essay");
  if (!essay) return;

  essay.addEventListener("input", updateWordCount);
}

function updateWordCount() {
  const essay = $("essay");
  if (!essay) return;

  const count = getWordCount(essay.value);
  const minimum = writingQuestions[state.task].minimum;

  setText($("words"), count);

  const progress = document.querySelector(".progress-fill");

  if (progress) {
    const percentage = Math.min(100, (count / minimum) * 100);
    progress.style.width = `${percentage}%`;
  }

  const suggestion = $("suggest");
  if (!suggestion) return;

  if (count === 0) {
    suggestion.textContent = "Start writing your answer.";
  } else if (count < minimum * 0.5) {
    suggestion.textContent = "Keep developing your ideas.";
  } else if (count < minimum) {
    suggestion.textContent = `You need about ${minimum - count} more words.`;
  } else {
    suggestion.textContent = "Good. You have reached the minimum word count.";
  }
}

/* IMAGE FILE HANDLING */
function initializeImageInputs() {
  const questionGallery = $("question-gallery");
  const questionFile = $("question-file");
  const answerGallery = $("answer-gallery");
  const answerFile = $("answer-file");

  if (questionGallery && questionFile) {
    questionGallery.addEventListener("click", () => questionFile.click());

    questionFile.addEventListener("change", async () => {
      const file = questionFile.files?.[0];
      if (file) await processImage(file, "question");
    });
  }

  if (answerGallery && answerFile) {
    answerGallery.addEventListener("click", () => answerFile.click());

    answerFile.addEventListener("change", async () => {
      const file = answerFile.files?.[0];
      if (file) await processImage(file, "answer");
    });
  }
}

async function processImage(file, target) {
  if (!file.type.startsWith("image/")) {
    showError($("writing-error"), "Please select an image file.");
    return;
  }

  const reader = new FileReader();

  reader.onload = async () => {
    const dataUrl = reader.result;

    if (target === "question") {
      state.questionImage = { file, dataUrl };
      displayImagePreview($("question-preview"), dataUrl);
      await readQuestionImage(file);
    } else {
      state.answerImage = { file, dataUrl };
      displayImagePreview($("answer-preview"), dataUrl);
      await readAnswerImage(file);
    }
  };

  reader.readAsDataURL(file);
}
