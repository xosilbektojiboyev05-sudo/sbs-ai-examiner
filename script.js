"use strict";

/* =========================================================
   IELTS AI EXAMINER
   Frontend controller
========================================================= */

/* =========================================================
   HELPERS
========================================================= */

const $ = (id) => document.getElementById(id);

const $$ = (selector) => {
  return Array.from(document.querySelectorAll(selector));
};

function show(element) {
  if (element) {
    element.hidden = false;
  }
}

function hide(element) {
  if (element) {
    element.hidden = true;
  }
}

function setText(element, value) {
  if (element) {
    element.textContent = value ?? "";
  }
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

  if (!cleaned) {
    return 0;
  }

  return cleaned.split(/\s+/).filter(Boolean).length;
}

function setButtonLoading(button, loading, text = "Processing...") {
  if (!button) {
    return;
  }

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

    if (data && data.detail) {
      return String(data.detail);
    }
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

/* =========================================================
   GLOBAL STATE
========================================================= */

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

/* =========================================================
   WRITING DATA
========================================================= */

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

/* =========================================================
   SPEAKING DATA
========================================================= */

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

/* =========================================================
   THEME
========================================================= */

function initializeTheme() {
  const themeButton = $("theme");

  if (!themeButton) {
    return;
  }

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

/* =========================================================
   MODE SWITCHING
========================================================= */

function initializeModes() {
  const modeTabs = $$(".mode-tab");

  modeTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const mode = tab.dataset.mode;

      if (!mode) {
        return;
      }

      switchMode(mode);
    });
  });
}

function switchMode(mode) {
  state.mode = mode;

  $$(".mode-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.mode === mode);
  });

  const writingMode = $("writing-mode");

  const speakingMode = $("speaking-mode");

  if (writingMode) {
    writingMode.classList.toggle("active", mode === "writing");
  }

  if (speakingMode) {
    speakingMode.classList.toggle("active", mode === "speaking");
  }
}

/* =========================================================
   WRITING TASK SWITCH
========================================================= */

function initializeWritingTasks() {
  $$(".task-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const task = button.dataset.task;

      if (!task) {
        return;
      }

      setWritingTask(task);
    });
  });
}

function setWritingTask(task) {
  if (task !== "1" && task !== "2") {
    return;
  }

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

/* =========================================================
   WRITING TIMER
========================================================= */

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

  if (!timer) {
    return;
  }

  setText(timer, formatTime(state.writingSeconds));

  const box = timer.closest(".timer-box");

  if (!box) {
    return;
  }

  box.classList.remove("warning", "danger");

  if (state.writingSeconds <= 60) {
    box.classList.add("danger");
  } else if (state.writingSeconds <= 5 * 60) {
    box.classList.add("warning");
  }
}

/* =========================================================
   WRITING WORD COUNT
========================================================= */

function initializeWritingEditor() {
  const essay = $("essay");

  if (!essay) {
    return;
  }

  essay.addEventListener("input", updateWordCount);
}

function updateWordCount() {
  const essay = $("essay");

  if (!essay) {
    return;
  }

  const count = getWordCount(essay.value);

  const minimum = writingQuestions[state.task].minimum;

  setText($("words"), count);

  const progress = document.querySelector(".progress-fill");

  if (progress) {
    const percentage = Math.min(100, (count / minimum) * 100);

    progress.style.width = `${percentage}%`;
  }

  const suggestion = $("suggest");

  if (!suggestion) {
    return;
  }

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

/* =========================================================
   IMAGE FILE HANDLING
========================================================= */

function initializeImageInputs() {
  const questionGallery = $("question-gallery");

  const questionFile = $("question-file");

  const answerGallery = $("answer-gallery");

  const answerFile = $("answer-file");

  if (questionGallery && questionFile) {
    questionGallery.addEventListener("click", () => questionFile.click());

    questionFile.addEventListener("change", async () => {
      const file = questionFile.files?.[0];

      if (file) {
        await processImage(file, "question");
      }
    });
  }

  if (answerGallery && answerFile) {
    answerGallery.addEventListener("click", () => answerFile.click());

    answerFile.addEventListener("change", async () => {
      const file = answerFile.files?.[0];

      if (file) {
        await processImage(file, "answer");
      }
    });
  }
}

async function processImage(file, target) {
  if (!file.type.startsWith("image/")) {
    showError(
      target === "question" ? $("writing-error") : $("writing-error"),
      "Please select an image file.",
    );

    return;
  }

  const reader = new FileReader();

  reader.onload = async () => {
    const dataUrl = reader.result;

    if (target === "question") {
      state.questionImage = {
        file,
        dataUrl,
      };

      displayImagePreview($("question-preview"), dataUrl);

      await readQuestionImage(file);
    } else {
      state.answerImage = {
        file,
        dataUrl,
      };

      displayImagePreview($("answer-preview"), dataUrl);

      await readAnswerImage(file);
    }
  };

  reader.readAsDataURL(file);
}

function displayImagePreview(container, dataUrl) {
  if (!container) {
    return;
  }

  container.classList.add("has-image");

  container.innerHTML = `
        <img
            src="${escapeHtml(dataUrl)}"
            alt="Uploaded image"
        >
    `;
}

/* =========================================================
   IMAGE → BACKEND
========================================================= */

async function readQuestionImage(file) {
  const errorBox = $("writing-error");

  hide(errorBox);

  try {
    const formData = new FormData();

    formData.append("image", file);

    const result = await fetchJson("/api/read-writing-image", {
      method: "POST",
      body: formData,
    });

    const question = $("question");

    if (question && result.question) {
      question.value = result.question;
    }
  } catch (error) {
    showError(errorBox, `Could not read the image: ${error.message}`);
  }
}

async function readAnswerImage(file) {
  const errorBox = $("writing-error");

  hide(errorBox);

  try {
    const formData = new FormData();

    formData.append("image", file);

    const result = await fetchJson("/api/read-writing-image", {
      method: "POST",
      body: formData,
    });

    const essay = $("essay");

    if (essay && result.answer) {
      essay.value = result.answer;

      updateWordCount();
    }
  } catch (error) {
    showError(
      errorBox,
      `Could not read the handwritten answer: ${error.message}`,
    );
  }
}

/* =========================================================
   PASTE IMAGE
========================================================= */

function initializePasteButtons() {
  const questionPaste = $("question-paste");

  const answerPaste = $("answer-paste");

  if (questionPaste) {
    questionPaste.addEventListener("click", () => pasteImage("question"));
  }

  if (answerPaste) {
    answerPaste.addEventListener("click", () => pasteImage("answer"));
  }

  document.addEventListener("paste", handleGlobalPaste);
}

async function pasteImage(target) {
  try {
    const clipboard = await navigator.clipboard.read();

    for (const clipboardItem of clipboard) {
      const imageType = clipboardItem.types.find((type) =>
        type.startsWith("image/"),
      );

      if (!imageType) {
        continue;
      }

      const blob = await clipboardItem.getType(imageType);

      const file = new File([blob], "clipboard-image.png", {
        type: imageType,
      });

      await processImage(file, target);

      return;
    }

    showError($("writing-error"), "No image was found in the clipboard.");
  } catch (error) {
    showError(
      $("writing-error"),
      "Clipboard access was blocked by the browser. Use Ctrl+V or upload the image.",
    );
  }
}

async function handleGlobalPaste(event) {
  const activeElement = document.activeElement;

  const isWritingField =
    activeElement === $("question") || activeElement === $("essay");

  if (!isWritingField) {
    return;
  }

  const items = event.clipboardData?.items || [];

  for (const item of items) {
    if (item.type && item.type.startsWith("image/")) {
      const file = item.getAsFile();

      if (!file) {
        continue;
      }

      event.preventDefault();

      const target = activeElement === $("question") ? "question" : "answer";

      await processImage(file, target);

      return;
    }
  }
}

/* =========================================================
   CAMERA
========================================================= */

function initializeCamera() {
  $("question-camera")?.addEventListener("click", () => openCamera("question"));

  $("answer-camera")?.addEventListener("click", () => openCamera("answer"));

  $("camera-close")?.addEventListener("click", closeCamera);

  $("camera-cancel")?.addEventListener("click", closeCamera);

  $("camera-capture")?.addEventListener("click", captureCameraImage);
}

async function openCamera(target) {
  const modal = $("camera-modal");

  const video = $("camera-video");

  if (!modal || !video) {
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showError(
      $("writing-error"),
      "Your browser does not support camera access.",
    );

    return;
  }

  try {
    state.cameraTarget = target;

    state.cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "environment",
      },
      audio: false,
    });

    video.srcObject = state.cameraStream;

    show(modal);
  } catch (error) {
    showError($("writing-error"), "Camera access was denied or unavailable.");
  }
}

function closeCamera() {
  const modal = $("camera-modal");

  const video = $("camera-video");

  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach((track) => track.stop());

    state.cameraStream = null;
  }

  if (video) {
    video.srcObject = null;
  }

  if (modal) {
    hide(modal);
  }

  state.cameraTarget = null;
}

async function captureCameraImage() {
  const video = $("camera-video");

  const canvas = $("camera-canvas");

  if (!video || !canvas || !state.cameraStream) {
    return;
  }

  const width = video.videoWidth || 1280;

  const height = video.videoHeight || 720;

  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");

  context.drawImage(video, 0, 0, width, height);

  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.88),
  );

  if (!blob) {
    return;
  }

  const file = new File([blob], "camera-photo.jpg", {
    type: "image/jpeg",
  });

  const target = state.cameraTarget;

  closeCamera();

  if (target) {
    await processImage(file, target);
  }
}

/* =========================================================
   WRITING EVALUATION
========================================================= */

function initializeWritingEvaluation() {
  const button = $("submit-writing");

  if (!button) {
    return;
  }

  button.addEventListener("click", evaluateWriting);
}

async function evaluateWriting() {
  const button = $("submit-writing");

  const question = $("question");

  const essay = $("essay");

  const errorBox = $("writing-error");

  hide(errorBox);

  if (!question?.value.trim()) {
    showError(errorBox, "Please enter or upload the IELTS question.");

    return;
  }

  if (!essay?.value.trim()) {
    showError(errorBox, "Please write or upload your answer first.");

    return;
  }

  setButtonLoading(button, true, "Evaluating...");

  try {
    const result = await fetchJson("/api/assess-writing", {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        task: state.task,
        question: question.value.trim(),
        essay: essay.value.trim(),
        language: "en",
      }),
    });

    renderWritingResult(result);
  } catch (error) {
    showError(errorBox, error.message);
  } finally {
    setButtonLoading(button, false);
  }
}

function renderWritingResult(result) {
  const resultSection = $("writing-result");

  show(resultSection);

  setText($("writing-overall"), result.overall_band ?? "—");

  setText($("writing-task-score"), result.task_score ?? "—");

  setText($("writing-coherence-score"), result.coherence_score ?? "—");

  setText($("writing-lexical-score"), result.lexical_score ?? "—");

  setText($("writing-grammar-score"), result.grammar_score ?? "—");

  setText($("writing-summary"), result.summary || "");

  renderList($("writing-strengths"), result.strengths);

  renderList($("writing-weaknesses"), result.weaknesses);

  renderList($("writing-corrections"), result.grammar_corrections);

  renderList($("writing-vocabulary"), result.vocabulary_suggestions);

  setText($("writing-next-steps"), result.improved_plan || "");

  resultSection.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}

/* =========================================================
   SPEAKING PART TABS
========================================================= */

function initializeSpeakingTabs() {
  $$(".speaking-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const part = Number(tab.dataset.part);

      switchSpeakingPart(part);
    });
  });
}

function switchSpeakingPart(part) {
  if (![1, 2, 3].includes(part)) {
    return;
  }

  if (state.isRecording) {
    return;
  }

  state.speakingPart = part;

  $$(".speaking-tab").forEach((tab) => {
    tab.classList.toggle("active", Number(tab.dataset.part) === part);
  });

  ["part1", "part2", "part3"].forEach((name) => {
    const panel = $(`${name}-panel`);

    if (!panel) {
      return;
    }

    panel.classList.toggle("active", name === `part${part}`);
  });

  if (part === 1) {
    updatePart1Question();
  } else if (part === 2) {
    resetPart2();
  } else if (part === 3) {
    updatePart3Question();
  }
}

/* =========================================================
   PART 1
========================================================= */

function initializePart1() {
  $("part1-next")?.addEventListener("click", () => {
    if (state.isRecording) {
      return;
    }

    if (state.part1Index < part1Questions.length - 1) {
      state.part1Index += 1;

      updatePart1Question();
    } else {
      updateSpeakingEvaluateState();
    }
  });

  updatePart1Question();
}

function updatePart1Question() {
  const question = part1Questions[state.part1Index];

  setText($("part1-question"), question);

  setText(
    $("part1-count"),
    `Question ${state.part1Index + 1} / ${part1Questions.length}`,
  );
}

/* =========================================================
   PART 2
========================================================= */

function initializePart2() {
  $("start-prep")?.addEventListener("click", startPart2Preparation);
}

function resetPart2() {
  stopPreparationTimer();

  stopSpeakingTimer();

  state.preparationSeconds = 60;

  state.speakingSeconds = 120;

  setText($("prep-timer"), "01:00");

  const button = $("start-prep");

  if (button) {
    button.disabled = false;

    button.textContent = "Start 1-minute preparation";
  }
}

function startPart2Preparation() {
  if (state.preparationTimer) {
    return;
  }

  const button = $("start-prep");

  if (button) {
    button.disabled = true;
    button.textContent = "Preparing...";
  }

  state.preparationSeconds = 60;

  setText($("prep-timer"), "01:00");

  state.preparationTimer = setInterval(() => {
    state.preparationSeconds -= 1;

    setText($("prep-timer"), formatTime(state.preparationSeconds));

    if (state.preparationSeconds <= 0) {
      stopPreparationTimer();

      setText(
        $("part2-instructions"),
        "Preparation finished. Start speaking for up to 2 minutes.",
      );

      startPart2Recording();
    }
  }, 1000);
}

function stopPreparationTimer() {
  if (state.preparationTimer) {
    clearInterval(state.preparationTimer);

    state.preparationTimer = null;
  }
}

async function startPart2Recording() {
  state.currentRecordingPart = 2;

  await startRecording();
}

/* =========================================================
   PART 3
========================================================= */

function initializePart3() {
  $("part3-next")?.addEventListener("click", () => {
    if (state.isRecording) {
      return;
    }

    if (state.part3Index < part3Questions.length - 1) {
      state.part3Index += 1;

      updatePart3Question();
    }
  });

  updatePart3Question();
}

function updatePart3Question() {
  const question = part3Questions[state.part3Index];

  setText($("part3-question"), question);

  setText(
    $("part3-count"),
    `Question ${state.part3Index + 1} / ${part3Questions.length}`,
  );
}

/* =========================================================
   RECORDING BUTTON
========================================================= */

function initializeRecorder() {
  const toggle = $("record-toggle");

  if (!toggle) {
    console.error("record-toggle element not found.");

    return;
  }

  toggle.addEventListener("click", async () => {
    if (state.isRecording) {
      await stopRecording();
    } else {
      if (state.speakingPart === 2) {
        state.currentRecordingPart = 2;
      } else {
        state.currentRecordingPart = state.speakingPart;
      }

      await startRecording();
    }
  });

  updateRecorderUI();
}

/* =========================================================
   START RECORDING
========================================================= */

async function startRecording() {
  if (state.isRecording) {
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showError(
      $("speaking-error"),
      "Your browser does not support microphone recording.",
    );

    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
    });

    let mimeType = "";

    const supportedTypes = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/ogg",
    ];

    for (const type of supportedTypes) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(type)) {
        mimeType = type;

        break;
      }
    }

    state.audioChunks = [];

    state.mediaRecorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);

    state.mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        state.audioChunks.push(event.data);
      }
    };

    state.mediaRecorder.onerror = (event) => {
      console.error("MediaRecorder error:", event);

      stopMediaStream();

      state.isRecording = false;

      updateRecorderUI();

      showError($("speaking-error"), "Recording failed. Please try again.");
    };

    state.mediaRecorder.onstop = async () => {
      stopMediaStream();

      const blob = new Blob(state.audioChunks, {
        type: state.mediaRecorder?.mimeType || "audio/webm",
      });

      state.mediaRecorder = null;

      if (blob.size === 0) {
        showError($("speaking-error"), "No audio was recorded.");

        return;
      }

      await processRecordedAnswer(blob);
    };

    state.mediaRecorder.start(250);

    state.isRecording = true;

    state.recordingStartedAt = Date.now();

    state.currentRecordingPart = state.speakingPart;

    startRecordingTimer();

    updateRecorderUI();

    if (state.currentRecordingPart === 2) {
      startPart2SpeakingTimer();
    }
  } catch (error) {
    console.error("Microphone error:", error);

    showError(
      $("speaking-error"),
      "Microphone access was denied or unavailable.",
    );
  }
}

/* =========================================================
   STOP RECORDING
========================================================= */

async function stopRecording() {
  if (!state.mediaRecorder || !state.isRecording) {
    return;
  }

  state.isRecording = false;

  stopRecordingTimer();

  stopSpeakingTimer();

  updateRecorderUI();

  try {
    state.mediaRecorder.stop();
  } catch (error) {
    console.error("Stop recording error:", error);

    stopMediaStream();
  }
}

/* =========================================================
   MEDIA STREAM
========================================================= */

function stopMediaStream() {
  if (state.mediaRecorder && state.mediaRecorder.stream) {
    state.mediaRecorder.stream.getTracks().forEach((track) => track.stop());
  }
}

/* =========================================================
   RECORDING TIMER
========================================================= */

function startRecordingTimer() {
  stopRecordingTimer();

  updateRecordingTimer();

  state.recordingTimer = setInterval(updateRecordingTimer, 500);
}

function stopRecordingTimer() {
  if (state.recordingTimer) {
    clearInterval(state.recordingTimer);

    state.recordingTimer = null;
  }
}

function updateRecordingTimer() {
  if (!state.recordingStartedAt) {
    setText($("record-timer"), "00:00");

    return;
  }

  const elapsed = Math.floor((Date.now() - state.recordingStartedAt) / 1000);

  setText($("record-timer"), formatTime(elapsed));
}

/* =========================================================
   PART 2 SPEAKING TIMER
========================================================= */

function startPart2SpeakingTimer() {
  stopSpeakingTimer();

  state.speakingSeconds = 120;

  state.speakingTimer = setInterval(async () => {
    if (!state.isRecording) {
      stopSpeakingTimer();

      return;
    }

    state.speakingSeconds -= 1;

    if (state.speakingSeconds <= 0) {
      stopSpeakingTimer();

      await stopRecording();
    }
  }, 1000);
}

function stopSpeakingTimer() {
  if (state.speakingTimer) {
    clearInterval(state.speakingTimer);

    state.speakingTimer = null;
  }
}

/* =========================================================
   RECORDER UI
========================================================= */

function updateRecorderUI() {
  const button = $("record-toggle");

  const text = $("record-toggle-text");

  const icon = $("record-toggle-icon");

  const dot = $("record-dot");

  const status = $("record-status-text");

  const wave = $("record-wave");

  if (button) {
    button.classList.toggle("recording", state.isRecording);
  }

  if (text) {
    text.textContent = state.isRecording
      ? "Stop & save answer"
      : "Start recording";
  }

  if (icon) {
    icon.textContent = state.isRecording ? "■" : "🎙";
  }

  if (dot) {
    dot.classList.toggle("recording", state.isRecording);
  }

  if (status) {
    status.textContent = state.isRecording ? "Recording..." : "Ready to record";
  }

  if (wave) {
    wave.classList.toggle("recording", state.isRecording);
  }
}

/* =========================================================
   PROCESS RECORDED ANSWER
========================================================= */

async function processRecordedAnswer(blob) {
  const errorBox = $("speaking-error");

  hide(errorBox);

  const part = state.currentRecordingPart;

  let question = "";

  if (part === 1) {
    question = part1Questions[state.part1Index];
  } else if (part === 2) {
    question = $("part2-question")?.textContent || "";
  } else {
    question = part3Questions[state.part3Index];
  }

  setText($("record-status-text"), "Transcribing...");

  try {
    const formData = new FormData();

    const extension = blob.type.includes("mp4") ? "mp4" : "webm";

    const file = new File([blob], `speaking-${Date.now()}.${extension}`, {
      type: blob.type || "audio/webm",
    });

    formData.append("audio", file);

    const result = await fetchJson("/api/speaking/transcribe", {
      method: "POST",
      body: formData,
    });

    const answer = String(result.text || "").trim();

    if (!answer) {
      throw new Error("No speech was detected in the recording.");
    }

    const answerObject = {
      id: Date.now() + Math.random(),

      part,

      question,

      answer,

      duration: getRecordedDuration(),
    };

    state.speakingAnswers.push(answerObject);

    renderSpeakingAnswers();

    updateSpeakingEvaluateState();

    /*
     * PART 1:
     * Automatically move to the next question
     * after saving the current answer.
     */

    if (part === 1) {
      if (state.part1Index < part1Questions.length - 1) {
        state.part1Index += 1;

        updatePart1Question();
      } else {
        setText(
          $("record-status-text"),
          "Part 1 complete. You can evaluate your speaking.",
        );
      }
    }

    /*
     * PART 3:
     * Automatically move to the next question
     * after saving the current answer.
     */

    if (part === 3) {
      if (state.part3Index < part3Questions.length - 1) {
        state.part3Index += 1;

        updatePart3Question();
      }
    }

    /*
     * PART 2:
     * After the 2-minute recording ends,
     * save the answer and return to Part 1.
     */

    if (part === 2) {
      setText($("part2-instructions"), "Your Part 2 answer has been saved.");
    }

    setText($("record-status-text"), "Answer saved");
  } catch (error) {
    console.error("Transcription error:", error);

    showError(errorBox, error.message);

    setText($("record-status-text"), "Transcription failed");
  } finally {
    state.recordingStartedAt = null;

    setText($("record-timer"), "00:00");

    updateRecorderUI();
  }
}

function getRecordedDuration() {
  if (!state.recordingStartedAt) {
    return 0;
  }

  return Math.max(
    0,
    Math.round((Date.now() - state.recordingStartedAt) / 1000),
  );
}

/* =========================================================
   RENDER SPEAKING ANSWERS
========================================================= */

function renderSpeakingAnswers() {
  const container = $("speaking-answers");

  if (!container) {
    return;
  }

  if (state.speakingAnswers.length === 0) {
    container.innerHTML = `
            <div class="empty-answers">
                Your recorded answers will appear here.
            </div>
        `;

    setText($("speaking-count"), "0 / 5");

    return;
  }

  container.innerHTML = state.speakingAnswers
    .map((item, index) => {
      return `
                        <article class="answer-item">

                            <div class="answer-item-header">

                                <span class="answer-item-label">
                                    Part ${item.part}
                                    · Answer ${index + 1}
                                </span>

                                <span class="answer-item-time">
                                    ${formatTime(item.duration)}
                                </span>

                            </div>

                            <p class="answer-item-text">
                                ${escapeHtml(item.answer)}
                            </p>

                        </article>
                    `;
    })
    .join("");

  const part1Count = state.speakingAnswers.filter(
    (item) => item.part === 1,
  ).length;

  setText($("speaking-count"), `${part1Count} / 5`);
}

/* =========================================================
   SPEAKING EVALUATION STATE
========================================================= */

function updateSpeakingEvaluateState() {
  const button = $("evaluate-speaking");

  if (!button) {
    return;
  }

  const part1Count = state.speakingAnswers.filter(
    (item) => item.part === 1 && item.answer.trim(),
  ).length;

  const ready =
    part1Count >= 5 && !state.isRecording && !state.isEvaluatingSpeaking;

  button.disabled = !ready;

  if (part1Count >= 5) {
    setText($("report-status"), "");

    setText(
      $("speaking-report-status"),
      "All 5 Part 1 answers are ready for evaluation.",
    );
  } else {
    setText(
      $("speaking-report-status"),
      `Record ${5 - part1Count} more Part 1 answer${
        5 - part1Count === 1 ? "" : "s"
      }.`,
    );
  }
}

/* =========================================================
   SPEAKING EVALUATION
========================================================= */

function initializeSpeakingEvaluation() {
  $("evaluate-speaking")?.addEventListener("click", evaluateSpeaking);
}

async function evaluateSpeaking() {
  if (state.isEvaluatingSpeaking) {
    return;
  }

  const part1Answers = state.speakingAnswers.filter(
    (item) => item.part === 1 && item.answer.trim(),
  );

  if (part1Answers.length < 5) {
    showError(
      $("speaking-error"),
      "Please complete all 5 Part 1 questions before evaluation.",
    );

    return;
  }

  const button = $("evaluate-speaking");

  const errorBox = $("speaking-error");

  hide(errorBox);

  state.isEvaluatingSpeaking = true;

  setButtonLoading(button, true, "Evaluating speaking...");

  try {
    const payload = {
      answers: state.speakingAnswers.map((item) => ({
        question: item.question,

        answer: item.answer,

        part: item.part,
      })),
    };

    const result = await fetchJson("/api/speaking/evaluate", {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify(payload),
    });

    renderSpeakingResult(result);
  } catch (error) {
    showError(errorBox, error.message);
  } finally {
    state.isEvaluatingSpeaking = false;

    setButtonLoading(button, false);

    updateSpeakingEvaluateState();
  }
}

/* =========================================================
   SPEAKING RESULT
========================================================= */

function renderSpeakingResult(result) {
  show($("speaking-result"));

  setText($("speaking-overall"), result.overall_band ?? "—");

  setText($("speaking-fluency"), result.fluency_coherence ?? "—");

  setText($("speaking-lexical"), result.lexical_resource ?? "—");

  setText($("speaking-grammar"), result.grammatical_range_accuracy ?? "—");

  setText($("speaking-pronunciation"), result.pronunciation ?? "—");

  setText($("speaking-summary"), result.summary || "");

  renderList($("speaking-strengths"), result.strengths);

  renderList($("speaking-weaknesses"), result.weaknesses);

  renderList($("speaking-corrections"), result.grammar_corrections);

  renderList($("speaking-vocabulary"), result.vocabulary_suggestions);

  renderList($("speaking-fluency-advice"), result.fluency_advice);

  renderList($("speaking-pronunciation-advice"), result.pronunciation_advice);

  renderList($("speaking-next-steps"), result.next_steps);

  $("speaking-result")?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}

/* =========================================================
   LIST RENDERER
========================================================= */

function renderList(container, items) {
  if (!container) {
    return;
  }

  if (!Array.isArray(items) || items.length === 0) {
    container.innerHTML = "<li>No specific feedback available.</li>";

    return;
  }

  container.innerHTML = items
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");
}

/* =========================================================
   ERROR DISPLAY
========================================================= */

function showError(element, message) {
  if (!element) {
    return;
  }

  element.textContent = message || "Something went wrong.";

  show(element);

  element.scrollIntoView({
    behavior: "smooth",
    block: "nearest",
  });
}

/* =========================================================
   KEYBOARD SHORTCUTS
========================================================= */

function initializeKeyboardShortcuts() {
  document.addEventListener("keydown", (event) => {
    /*
     * Escape closes camera.
     */

    if (event.key === "Escape" && !$("camera-modal")?.hidden) {
      closeCamera();

      return;
    }

    /*
     * Ctrl + Enter evaluates writing.
     */

    if (event.ctrlKey && event.key === "Enter" && state.mode === "writing") {
      event.preventDefault();

      evaluateWriting();
    }
  });
}

/* =========================================================
   INITIALIZATION
========================================================= */

function initializeApp() {
  console.log("IELTS AI Examiner initialized.");

  initializeTheme();

  initializeModes();

  initializeWritingTasks();

  initializeWritingEditor();

  initializeImageInputs();

  initializePasteButtons();

  initializeCamera();

  initializeWritingEvaluation();

  initializeSpeakingTabs();

  initializePart1();

  initializePart2();

  initializePart3();

  initializeRecorder();

  initializeSpeakingEvaluation();

  initializeKeyboardShortcuts();

  setWritingTask("1");

  updateWordCount();

  renderSpeakingAnswers();

  updateSpeakingEvaluateState();

  updateRecorderUI();

  resetPart2();

  switchSpeakingPart(1);

  /*
   * Start the Writing timer only after
   * the page has initialized.
   */

  startWritingTimer();
}

/* =========================================================
   START APP
========================================================= */

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeApp, {
    once: true,
  });
} else {
  initializeApp();
}
