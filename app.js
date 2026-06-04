// ========================
// IMPORT GOOGLE GEMINI SDK
// ========================
//import { GoogleGenerativeAI } from "https://esm.run/@google/generative-ai";

// ========================
// QUẢN LÝ API KEY (ĐỒNG BỘ ĐA THIẾT BỊ QUA FIREBASE)
// ========================
let API_KEYS = [];
let currentKeyIndex = 0;

let AI_PROVIDER = "gemini"; // "gemini" hoặc "groq"
let GROQ_KEYS = [];
let currentGroqKeyIndex = 0;

function updateAIUI() {
  const select = document.getElementById("activeAIProviderSelect");
  if (select) {
    select.value = AI_PROVIDER;
    if (AI_PROVIDER === "groq") {
      select.style.background = "#fef3c7";
      select.style.color = "#92400e";
    } else {
      select.style.background = "#e0e7ff";
      select.style.color = "#4338ca";
    }
  }
}

window.switchMainAIProvider = function (provider) {
  AI_PROVIDER = provider;
  updateAIUI();
  // Đồng bộ với Chat Modal nếu có
  const chatSelect = document.getElementById("aiChatProviderSelect");
  if (chatSelect) {
    chatSelect.value = provider;
  }
};

// Hệ thống bảo vệ Focus để sửa lỗi nhảy App trên Windows
window.forceFocusBack = function () {
  const recapturingFocus = () => {
    window.focus();
    document.body.focus();
    // Thêm một micro-task để đảm bảo focus được thực thi sau khi OS trả lại quyền
    setTimeout(() => {
      window.focus();
      if (document.activeElement) document.activeElement.blur();
    }, 50);
  };
  // Lắng nghe sự kiện focus tiếp theo (khi hộp thoại file đóng)
  window.addEventListener('focus', recapturingFocus, { once: true });
};

// 1. Hàm lưu Key (Vừa lưu máy này, vừa lưu lên Cloud)
async function saveKeysToStorage(keysArray, provider = "gemini") {
  const cleanKeys = keysArray.map((k) => k.trim()).filter((k) => k.length > 10);

  if (provider === "gemini") {
    API_KEYS = cleanKeys;
    localStorage.setItem("gemini_api_keys", JSON.stringify(cleanKeys));
    currentKeyIndex = 0;
  } else {
    GROQ_KEYS = cleanKeys;
    localStorage.setItem("groq_api_keys", JSON.stringify(cleanKeys));
    currentGroqKeyIndex = 0;
  }

  // Lưu lên Cloud (Firebase)
  const user = auth.currentUser;
  if (user) {
    try {
      await db.collection("users").doc(user.uid).set(
        {
          apiKeys: API_KEYS,
          groqKeys: GROQ_KEYS,
          aiProvider: AI_PROVIDER
        },
        { merge: true }
      );
      cloudAlert({ title: "Thành công", message: `Đã lưu cấu hình ${provider.toUpperCase()} vào tài khoản!`, icon: "✅" });
    } catch (e) {
      console.error("Lỗi lưu Cloud:", e);
    }
  } else {
    cloudAlert({ title: "Thành công", message: `Đã lưu ${cleanKeys.length} Key vào máy này.`, icon: "✅" });
  }
  updateAIUI();
}

// 2. Hàm tải Key từ Cloud về (Chạy khi đăng nhập)
async function syncKeysFromCloud(user) {
  if (!user) return;

  try {
    const doc = await db.collection("users").doc(user.uid).get();
    if (doc.exists) {
      const data = doc.data();
      if (data.apiKeys) {
        API_KEYS = data.apiKeys;
        localStorage.setItem("gemini_api_keys", JSON.stringify(API_KEYS));
      }
      if (data.groqKeys) {
        GROQ_KEYS = data.groqKeys;
        localStorage.setItem("groq_api_keys", JSON.stringify(GROQ_KEYS));
      }
      if (data.aiProvider) {
        AI_PROVIDER = data.aiProvider;
      }
      updateAIUI();
      console.log("☁️ Đã đồng bộ cấu hình AI từ Cloud.");
    }
  } catch (e) {
    console.error("Lỗi đồng bộ Key:", e);
  }
}

// 3. Hàm tải Key từ Local (Chạy khi mới mở web)
function loadKeysFromLocal() {
  const gStored = localStorage.getItem("gemini_api_keys");
  if (gStored) {
    try { API_KEYS = JSON.parse(gStored); } catch (e) { }
  }
  const grStored = localStorage.getItem("groq_api_keys");
  if (grStored) {
    try { GROQ_KEYS = JSON.parse(grStored); } catch (e) { }
  }
}

// 4. Cấu hình AI
// 4. Cấu hình AI
window.promptForKeys = async function () {
  // Quản lý Gemini Keys
  const gInput = await cloudAlert({
    type: 'prompt',
    title: 'Cấu hình Gemini (Google)',
    message: 'Nhập danh sách API Key Gemini (Mỗi key một dòng):',
    defaultValue: API_KEYS.join("\n"),
    icon: '💎'
  });
  if (gInput !== null) {
    const keys = gInput.split(/[\n,]+/).map(k => k.trim()).filter(k => k);
    saveKeysToStorage(keys, "gemini");
  }

  // Quản lý Groq Keys
  const grInput = await cloudAlert({
    type: 'prompt',
    title: 'Cấu hình Groq',
    message: 'Nhập danh sách API Key Groq (Mỗi key một dòng):',
    defaultValue: GROQ_KEYS.join("\n"),
    icon: '⚡'
  });
  if (grInput !== null) {
    const keys = grInput.split(/[\n,]+/).map(k => k.trim()).filter(k => k);
    saveKeysToStorage(keys, "groq");
  }
}

// Hàm nhảy key tự động
function rotateKey(provider) {
  if (provider === "gemini" && API_KEYS.length > 0) {
    currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
  } else if (provider === "groq" && GROQ_KEYS.length > 0) {
    currentGroqKeyIndex = (currentGroqKeyIndex + 1) % GROQ_KEYS.length;
  }
}

// Khởi động: Tải từ local trước cho nhanh
loadKeysFromLocal();
updateAIUI();

// ========================
// BIẾN TOÀN CỤC
// ========================
let questionsData = [];
let pendingData = null;
let timerInterval = null;
let remainingSeconds = 0;
let examFinished = false;
let examTotalSeconds = 0;
let globalHistoryData = [];
let driveCache = {}; // Lưu trữ dữ liệu folder đã tải để không phải tải lại
let isReviewMode = false; // Trạng thái chế độ ôn tập
let scoreChart = null;

const API_KEY = "AIzaSyAry4xCdznJGeWvTi1NtId0q6YgPfZdwrg"; // Key cũ cho Drive (nếu cần)
const DRIVE_FOLDER_ID = "";

// ==========================================
// HỆ THỐNG QUẢN LÝ CÂU SAI (CLOUD FIREBASE)
// ==========================================

// Hàm tạo Key an toàn: Tự động chuyển sang mã Hash nếu câu quá dài
function getSmartKey(text) {
  // Nếu câu ngắn (< 300 ký tự) -> Dùng cách cũ (Base64) để tương thích dữ liệu cũ
  if (text.length < 300) return encodeKey(text);

  // Nếu câu dài -> Tạo mã Hash ngắn gọn (Ví dụ: long_q_152342)
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  return "long_q_" + Math.abs(hash);
}

// 1. Hàm dọn dẹp tên đề thi để làm ID (Tránh lỗi ký tự cấm của Firebase)
const getSafeId = (str) => {
  if (!str) return "unknown_exam";
  // Chuyển tiếng Việt có dấu thành không dấu (tùy chọn, để ID đẹp hơn)
  const noAccent = str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  // Thay thế các ký tự cấm: . # $ [ ] / bằng dấu gạch dưới
  return noAccent.trim().replace(/[\/\#\$\.\[\]\s]/g, "_");
};

// SỬA LỖI: Thay thế các ký tự cấm của Firebase (+, /) bằng (-, _)
const encodeKey = (str) => {
  return btoa(unescape(encodeURIComponent(str.trim())))
    .replace(/\+/g, "-") // Thay dấu + thành -
    .replace(/\//g, "_") // Thay dấu / thành _ (SỬA LỖI QUAN TRỌNG)
    .replace(/=+$/, ""); // Xóa dấu = ở cuối cho gọn
};

const decodeKey = (str) => {
  try {
    // Khôi phục lại ký tự gốc trước khi giải mã
    str = str.replace(/-/g, "+").replace(/_/g, "/");
    // Thêm lại padding (=) nếu thiếu
    while (str.length % 4) {
      str += "=";
    }
    return decodeURIComponent(escape(atob(str)));
  } catch (e) {
    return "Lỗi mã hóa câu hỏi";
  }
};

// 2. Cập nhật lỗi lên Cloud (Cộng hoặc Trừ)
// 2. Cập nhật lỗi lên Cloud (Cộng hoặc Trừ) - PHIÊN BẢN FIX LỖI TREO
async function updateMistakeInCloud(examName, questionText, isCorrect) {
  const user = auth.currentUser;
  if (!user) return 0;

  const safeExamId = getSafeId(examName);
  const originalKey = encodeKey(questionText);
  const qKey = getSmartKey(questionText);
  let targetKey = originalKey; // Mặc định dùng khóa tạo từ text

  // Kiểm tra độ dài khóa (Firestore giới hạn 1500 bytes)
  if (targetKey.length > 1000) {
    console.warn(
      "⚠️ Câu hỏi quá dài, có thể gây lỗi Cloud:",
      questionText.substring(0, 50) + "..."
    );
  }

  const docRef = db
    .collection("users")
    .doc(user.uid)
    .collection("mistake_tracking")
    .doc(safeExamId);

  try {
    // --- BƯỚC 1: LẤY DỮ LIỆU ĐỂ KIỂM TRA TRƯỚC ---
    const doc = await docRef.get();

    // Nếu chưa có dữ liệu gì trên Cloud
    if (!doc.exists) {
      if (isCorrect) return 0; // Đúng thì thôi, không cần làm gì
      // Nếu sai thì tạo mới ở dưới
    }

    let currentCount = 0;

    // --- BƯỚC 2: TÌM KHÓA CHÍNH XÁC (SMART LOOKUP) ---
    if (doc.exists) {
      const data = doc.data();

      // Trường hợp 1: Khóa khớp hoàn toàn
      if (data[targetKey] !== undefined) {
        currentCount = data[targetKey];
      }
      // Trường hợp 2: Khóa bị lệch (do khoảng trắng/encode), phải đi tìm
      else {
        // Quét tất cả các khóa đang có để tìm câu tương tự
        const cleanQ = questionText.trim();
        const foundKey = Object.keys(data).find((k) => {
          if (k === "last_updated") return false;
          try {
            // Giải mã khóa cũ xem có khớp nội dung không
            return decodeKey(k).trim() === cleanQ;
          } catch (e) {
            return false;
          }
        });

        if (foundKey) {
          console.log("🔧 Đã tìm thấy khóa khớp (Fix lỗi lệch):", foundKey);
          targetKey = foundKey; // Dùng khóa thực tế trong DB
          currentCount = data[foundKey];
        }
      }
    }

    // --- BƯỚC 3: THỰC HIỆN CẬP NHẬT ---
    if (!isCorrect) {
      // TRƯỜNG HỢP SAI: Cộng thêm 1
      const newCount = currentCount + 1;
      // Dùng set({merge: true}) an toàn hơn update
      let valueToSave;
      if (questionText.length >= 300) {
        valueToSave = { c: newCount, t: questionText };
      } else {
        valueToSave = newCount;
      }

      await docRef.set(
        {
          [qKey]: valueToSave,
          last_updated: firebase.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return "increased";
    } else {
      // TRƯỜNG HỢP ĐÚNG: Xóa hoặc Trừ
      if (currentCount <= 1) {
        // Hết nợ -> Xóa field
        await docRef.update({
          [qKey]: firebase.firestore.FieldValue.delete(),
        });
        return 0;
      } else {
        const newCount = currentCount - 1;
        let valueToSave = newCount;

        // Nếu đang là dạng Object (câu dài), phải giữ nguyên cấu trúc Object để không mất text
        if (questionText.length >= 300) {
          valueToSave = { c: newCount, t: questionText };
        }

        await docRef.update({
          [qKey]: valueToSave,
        });
        return newCount;
      }
    }
  } catch (e) {
    console.error("Lỗi cập nhật Cloud:", e);
    // Nếu lỗi do field quá dài hoặc lỗi khác, trả về -1 để UI báo lỗi
    return -1;
  }
}

// 3. Tải danh sách lỗi về để ôn
async function fetchMistakesFromCloud(examName) {
  const user = auth.currentUser;
  if (!user) return {};

  const safeExamId = getSafeId(examName);
  try {
    const doc = await db
      .collection("users")
      .doc(user.uid)
      .collection("mistake_tracking")
      .doc(safeExamId)
      .get();
    if (doc.exists) {
      return doc.data();
    }
  } catch (e) {
    console.error("Lỗi tải câu sai:", e);
  }
  return {};
}

// ========================
// CÁC HÀM UI CƠ BẢN
// ========================

function setHeaderMode(mode) {
  const setup = document.getElementById("setupPanel");
  const status = document.getElementById("statusPanel");
  const mainHeader = document.getElementById("mainHeader");
  const activeHeader = document.getElementById("examActiveHeader");
  const progressBar = document.querySelector(".progress-container"); // Lấy thanh tiến trình
  document.body.classList.toggle("exam-taking", mode === "active");
  document.body.classList.toggle("home-mode", mode !== "active");

  if (mode === "active") {
    // --- ĐANG LÀM BÀI ---
    const summaryEl = document.getElementById("examHistorySummary");
    if (summaryEl) summaryEl.style.display = "none";
    const activeExamName = document.getElementById("activeExamName");
    const examName = document.getElementById("examName");
    if (activeExamName && examName) activeExamName.textContent = examName.textContent;
    if (mainHeader) mainHeader.style.display = "none";
    if (activeHeader) activeHeader.style.display = "flex";
    setup.style.display = "none";
    status.style.display = "flex";
    if (progressBar) progressBar.style.display = "block"; // HIỆN thanh tiến trình
  } else {
    // --- CHẾ ĐỘ CHỜ / SETUP ---
    if (mainHeader) mainHeader.style.display = "flex";
    if (activeHeader) activeHeader.style.display = "none";
    if (mainHeader) mainHeader.classList.remove("header-hidden");
    const headerToggle = document.getElementById("btnToggleHeaderMobile");
    if (headerToggle) headerToggle.textContent = "▲";
    setup.style.display = "flex";
    status.style.display = "none";
    if (progressBar) progressBar.style.display = "none"; // ẨN thanh tiến trình
  }
}

function updateFileStatus(name, ready) {
  const el = document.getElementById("fileStatusLabel");
  const homeSelectedExam = document.getElementById("homeSelectedExam");
  if (ready) {
    el.innerHTML = `<span class="file-status-dot"></span><span>Đã chọn: ${name}</span>`;
    el.className = "file-status ready";
    if (homeSelectedExam) homeSelectedExam.textContent = name;
    document.getElementById("btnStart").disabled = false;
    document.getElementById("btnStart").style.opacity = "1";
    document.getElementById("btnStart").innerHTML = `<span class="menu-emoji emoji-pop" aria-hidden="true">🚀</span><span>Bắt đầu ngay</span>`;
  } else {
    el.innerHTML = `<span class="file-status-dot"></span><span>Chưa chọn đề</span>`;
    el.className = "file-status";
    if (homeSelectedExam) homeSelectedExam.textContent = "Chưa có đề được chọn";
    document.getElementById("btnStart").disabled = true;
    document.getElementById("btnStart").style.opacity = "0.5";
    document.getElementById("btnStart").innerHTML = `<span class="menu-emoji emoji-pop" aria-hidden="true">🚀</span><span>Bắt đầu</span>`;
  }
  if (window.lucide) lucide.createIcons();
}

function renderHomeScreen() {
  const quiz = document.getElementById("quiz");
  if (!quiz) return;
  quiz.innerHTML = `
    <div class="home-shell">
      <section class="home-hero">
        <div class="home-hero-copy">
          <span class="home-kicker">MindQuiz Workspace</span>
          <h2>🎯 Luyện đề tập trung, theo dõi tiến bộ rõ ràng</h2>
          <p>Chọn đề từ máy hoặc Kho Đề, đặt thời gian và bắt đầu phiên làm bài ngay trên cùng một màn hình.</p>
          <div class="home-actions">
            <button class="home-primary-action" type="button" onclick="document.getElementById('fileInput').click()">
              <span class="emoji-pop">📄</span>
              <span>Tải đề JSON</span>
            </button>
            <button class="home-secondary-action" type="button" onclick="window.chooseExamFromDriveFolder && window.chooseExamFromDriveFolder()">
              <span class="emoji-pop">🗂️</span>
              <span>Mở Kho Đề</span>
            </button>
          </div>
        </div>
        <div class="home-focus-panel">
          <div class="focus-ring">
            <span class="emoji-pulse">🎯</span>
          </div>
          <div>
            <span>Phiên luyện tập</span>
            <strong id="homeSelectedExam">Chưa có đề được chọn</strong>
          </div>
        </div>
      </section>
      <section class="home-grid">
        <article class="home-card">
          <span class="home-card-emoji emoji-pop">🗂️</span>
          <span>🗂️ Nguồn đề</span>
          <strong>Local / Cloud</strong>
        </article>
        <article class="home-card">
          <span class="home-card-emoji emoji-pop">⏱️</span>
          <span>⏱️ Thời lượng</span>
          <strong><span id="homeTimePreview">${document.getElementById("timeInput")?.value || 15}</span> phút</strong>
        </article>
        <article class="home-card">
          <span class="home-card-emoji emoji-pop">📈</span>
          <span>📈 Lịch sử</span>
          <strong>Có phân tích</strong>
        </article>
      </section>
    </div>
  `;
  if (window.lucide) lucide.createIcons();
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

function updateTimerDisplay() {
  const el = document.getElementById("timer");
  const activeEl = document.getElementById("activeTimerDisplay");
  const activeBubble = document.getElementById("activeTimerBubble");
  el.textContent = formatTime(remainingSeconds);
  el.classList.remove("danger");
  if (activeEl) activeEl.textContent = formatTime(remainingSeconds);
  if (activeBubble) activeBubble.classList.remove("danger");
  if (remainingSeconds <= 60) {
    el.classList.add("danger");
    if (activeBubble) activeBubble.classList.add("danger");
  }
  if (window.lucide) lucide.createIcons();
}

function startTimer() {
  if (timerInterval) clearInterval(timerInterval);
  const min = parseInt(document.getElementById("timeInput").value) || 15;
  examTotalSeconds = min * 60;
  remainingSeconds = examTotalSeconds;
  updateTimerDisplay();

  timerInterval = setInterval(() => {
    if (remainingSeconds <= 0) {
      clearInterval(timerInterval);
      if (!examFinished) grade(true);
      return;
    }
    remainingSeconds--;
    updateTimerDisplay();
  }, 1000);
}

function shuffleArray(arr) {
  if (!Array.isArray(arr)) return arr;
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ========================
// LOGIC ĐỀ THI
// ========================

// Hàm chuẩn hóa chuỗi để so sánh chính xác (xóa khoảng trắng, chuẩn hóa ngoặc kép)
// Hàm chuẩn hóa chuỗi để so sánh chính xác (Xóa ngoặc, xóa chấm cuối, xóa khoảng trắng)
function normalizeText(str) {
  if (!str) return "";
  return str.toString()
    .trim()
    .replace(/[“”"‘’']/g, '') // Xóa hết mọi loại dấu ngoặc để so sánh nội dung thuần
    .replace(/\.$/, '')       // Xóa dấu chấm ở cuối câu nếu có
    .replace(/\s+/g, " ");    // Chuẩn hóa khoảng trắng
}

async function handleDataLoaded(data, fileName) {
  if (!Array.isArray(data) || data.length === 0) {
    cloudAlert({ title: "Lỗi File", message: "File không hợp lệ hoặc không có câu hỏi.", icon: "❌" });
    return;
  }
  pendingData = { data: data, name: fileName };
  updateFileStatus(fileName, true);

  document.getElementById("quiz").innerHTML = `
    <div class="home-shell is-ready">
      <section class="home-hero">
        <div class="home-hero-copy">
          <span class="home-kicker">✅ Đề đã sẵn sàng</span>
          <h2>${fileName}</h2>
          <p>📝 ${data.length} câu hỏi đã được nạp vào phiên luyện tập.</p>
          <div class="home-actions">
            <button class="home-primary-action" type="button" onclick="window.startExamNow()">
              <span class="emoji-pop">🚀</span>
              <span>Bắt đầu làm bài</span>
            </button>
            <button class="home-secondary-action" type="button" onclick="document.getElementById('fileInput').click()">
              <span class="emoji-pop">🔄</span>
              <span>Đổi đề khác</span>
            </button>
          </div>
        </div>
        <div class="home-focus-panel">
          <div class="focus-ring">
            <span class="emoji-pulse">✅</span>
          </div>
          <div>
            <span>Đang chọn</span>
            <strong>${fileName}</strong>
          </div>
        </div>
      </section>
    </div>
  `;
  if (window.lucide) lucide.createIcons();
  await checkCurrentExamHistorySummary(fileName);
}

// Expose functions to window (vì dùng type=module)
window.startExamNow = async function () {
  if (!pendingData) {
    cloudAlert({ title: "Thông báo", message: "Vui lòng chọn file đề trước!", icon: "ℹ️" });
    return;
  }
  isReviewMode = false;
  const cloned = pendingData.data.map((q) => ({
    ...q,
    options: Array.isArray(q.options) ? [...q.options] : [],
  }));
  shuffleArray(cloned);
  cloned.forEach((q) => {
    if (Array.isArray(q.options)) shuffleArray(q.options);
  });

  questionsData = cloned;
  examFinished = false;

  document.getElementById("btnGradeHeader").style.display = "block";
  document.getElementById("btnGradeNav").style.display = "block";
  const activeGrade = document.getElementById("btnActiveGrade");
  if (activeGrade) activeGrade.style.display = "inline-flex";
  document.getElementById("examName").textContent = pendingData.name;
  const activeExamName = document.getElementById("activeExamName");
  if (activeExamName) activeExamName.textContent = pendingData.name;
  const summaryEl = document.getElementById("examHistorySummary");
  if (summaryEl) summaryEl.style.display = "none";
  setHeaderMode("active");

  generateQuiz();
  startTimer();

  // Mobile
  if (window.innerWidth <= 850) {
    const header = document.getElementById("mainHeader");
    const toggleBtn = document.getElementById("btnToggleHeaderMobile");
    header.classList.add("header-hidden");
    toggleBtn.textContent = "▼";
  }

  document.getElementById("result").textContent = "";
  document.getElementById("topResult").style.display = "none";
};

window.loadFileFromLocal = function () {
  const fileInput = document.getElementById("fileInput");
  const file = fileInput.files[0];
  if (!file) return;

  // Lấy lại focus ngay lập tức
  window.focus();

  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const data = JSON.parse(e.target.result);
      const name = file.name.replace(/\.json$/i, "");
      handleDataLoaded(data, name);
    } catch (err) {
      cloudAlert({ title: "Lỗi", message: "Lỗi đọc JSON.", icon: "❌" });
    }
  };
  reader.readAsText(file);
  fileInput.value = "";
};

// ==========================================
// CLOUD EXPLORER — QUẢN LÝ THƯ MỤC VÀ ĐỀ THI
// ==========================================

let currentFolderId = null;
let cloudPath = [{ id: null, name: 'Kho Đề' }];

// Render Breadcrumb
function renderBreadcrumb() {
  const bcEl = document.getElementById("cloudBreadcrumb");
  if (!bcEl) return;
  let html = "";
  cloudPath.forEach((item, index) => {
    if (index > 0) html += `<span class="bc-separator">/</span>`;
    html += `<span class="bc-item" onclick="window.navigateToFolder('${item.id}', ${index})">
      ${index === 0 ? '🏠 ' : ''}${item.name}
    </span>`;
  });
  bcEl.innerHTML = html;
}

// Chuyển đến thư mục
window.navigateToFolder = function (folderId, pathIndex = -1) {
  currentFolderId = folderId === "null" ? null : folderId;
  if (pathIndex >= 0) {
    cloudPath = cloudPath.slice(0, pathIndex + 1);
  }
  renderBreadcrumb();
  loadCloudDirectory();
};

// ==========================================
// CUSTOM UI UTILS (CLOUD ALERT)
// ==========================================
window.cloudAlert = function ({ type = 'alert', title = 'Thông báo', message = '', icon = 'ℹ️', defaultValue = '', confirmText = 'Đồng ý', cancelText = 'Hủy' }) {
  return new Promise((resolve) => {
    const overlay = document.getElementById("cloudAlertOverlay");
    document.getElementById("cloudAlertTitle").textContent = title;
    document.getElementById("cloudAlertMessage").textContent = message;

    const iconEl = document.getElementById("cloudAlertIcon");
    iconEl.textContent = type === 'loading' ? '' : icon;
    if (type === 'loading') iconEl.classList.add('loading');
    else iconEl.classList.remove('loading');

    const inputWrapper = document.getElementById("cloudAlertInputWrapper");
    const inputEl = document.getElementById("cloudAlertInput");
    const btnCancel = document.getElementById("btnCloudAlertCancel");
    const btnConfirm = document.getElementById("btnCloudAlertConfirm");
    const btnCloseTop = document.getElementById("btnCloseCloudAlert");

    btnConfirm.textContent = confirmText;
    btnCancel.textContent = cancelText;

    if (type === 'prompt') {
      inputWrapper.style.display = "block";
      inputEl.value = defaultValue;
      setTimeout(() => inputEl.focus(), 300);
    } else {
      inputWrapper.style.display = "none";
    }

    if (type === 'alert' || type === 'loading') {
      btnCancel.style.display = "none";
      btnCloseTop.style.display = type === 'loading' ? "none" : "flex";
    } else {
      btnCancel.style.display = "block";
      btnCloseTop.style.display = "flex";
    }

    if (type === 'loading') {
      btnConfirm.style.display = "none";
    } else {
      btnConfirm.style.display = "block";
    }

    overlay.style.display = "flex";

    const close = (result) => {
      if (type !== 'loading') overlay.style.display = "none";
      resolve(result);
    };

    btnCancel.onclick = () => {
      if (type === 'confirm') close(false);
      else close(null);
    };
    btnCloseTop.onclick = () => close(null);
    btnConfirm.onclick = () => {
      if (type === 'prompt') close(inputEl.value);
      else close(true);
    };

    if (type === 'prompt') {
      inputEl.onkeyup = (e) => {
        if (e.key === 'Enter') close(inputEl.value);
      }
    }
  });
};

window.closeCloudAlert = function () {
  document.getElementById("cloudAlertOverlay").style.display = "none";
};

// ==========================================
// FOLDER & FILE LOGIC — DRAG & DROP
// ==========================================

// Global flag to prevent click after drag
let _dragJustHappened = false;
let _dragJustHappenedTimer = null;

window.handleItemDragStart = function (e, id, type) {
  e.dataTransfer.setData("itemId", id);
  e.dataTransfer.setData("itemType", type);
  e.dataTransfer.effectAllowed = "move";
  _dragJustHappened = true;
  if (_dragJustHappenedTimer) clearTimeout(_dragJustHappenedTimer);

  // Hieu ung mo cho item dang bi keo
  const el = e.currentTarget;
  el.style.opacity = "0.5";
  el.classList.add("dragging");
};

window.handleItemDragEnd = function (e) {
  const el = e.currentTarget;
  el.style.opacity = "1";
  el.classList.remove("dragging");
  // Keep flag true briefly to suppress the click event that fires after dragend
  _dragJustHappenedTimer = setTimeout(() => {
    _dragJustHappened = false;
  }, 300);
};

window.handleItemDragOver = function (e, el) {
  e.preventDefault();
  e.stopPropagation();
  e.dataTransfer.dropEffect = "move";
  el.classList.add("drag-target");
};

window.handleItemDragLeave = function (e, el) {
  // Only remove class if we actually left the element (not just moved to a child)
  if (!el.contains(e.relatedTarget)) {
    el.classList.remove("drag-target");
  }
};

window.handleItemDrop = async function (e, targetFolderId) {
  e.preventDefault();
  e.stopPropagation();
  const el = e.currentTarget;
  el.classList.remove("drag-target");

  const itemId = e.dataTransfer.getData("itemId");
  const itemType = e.dataTransfer.getData("itemType");

  if (!itemId || !targetFolderId || itemId === targetFolderId) return;

  const user = auth.currentUser;
  if (!user) return;

  try {
    if (itemType === 'file') {
      await db.collection("users").doc(user.uid).collection("examFiles").doc(itemId).update({
        folderId: targetFolderId
      });
    } else if (itemType === 'folder') {
      await db.collection("users").doc(user.uid).collection("folders").doc(itemId).update({
        parentId: targetFolderId
      });
    }
    loadCloudDirectory();
  } catch (err) {
    console.error("Loi di chuyen:", err);
    cloudAlert({ title: "Loi", message: "Khong the di chuyen: " + err.message, icon: "❌" });
  }
};

// Drop to root level (move item to current folder root)
window.handleRootDrop = async function (e) {
  e.preventDefault();
  const cloudBody = document.getElementById("cloudBody");
  if (cloudBody) cloudBody.classList.remove("drag-over");

  const itemId = e.dataTransfer.getData("itemId");
  const itemType = e.dataTransfer.getData("itemType");
  if (!itemId) return;

  const user = auth.currentUser;
  if (!user) return;

  // Move to currentFolderId (null = root)
  const targetId = currentFolderId || null;

  try {
    if (itemType === 'file') {
      await db.collection("users").doc(user.uid).collection("examFiles").doc(itemId).update({
        folderId: targetId
      });
    } else if (itemType === 'folder') {
      await db.collection("users").doc(user.uid).collection("folders").doc(itemId).update({
        parentId: targetId
      });
    }
    loadCloudDirectory();
  } catch (err) {
    console.error("Loi di chuyen ve root:", err);
  }
};

window.handleRootDragOver = function (e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  const cloudBody = document.getElementById("cloudBody");
  if (cloudBody) cloudBody.classList.add("drag-over");
};

window.handleRootDragLeave = function (e) {
  const cloudBody = document.getElementById("cloudBody");
  if (cloudBody && !cloudBody.contains(e.relatedTarget)) {
    cloudBody.classList.remove("drag-over");
  }
};

// --- LOGIC MODAL DI CHUYỂN (MOVE TO) ---
let movingItemId = null;
let movingItemType = null;
let movingItemSourceParentId = null; // Thư mục gốc ban đầu
let moveCurrentFolderId = null;
let movePath = [{ id: null, name: 'Gốc' }];

window.openMoveModal = function (id, type, name, sourceParentId) {
  movingItemId = id;
  movingItemType = type;
  // Chuẩn hóa sourceParentId (vì Firestore có thể trả về null hoặc chuỗi "null")
  movingItemSourceParentId = (sourceParentId === "null" || !sourceParentId) ? null : sourceParentId;
  moveCurrentFolderId = null;
  movePath = [{ id: null, name: 'Kho Đề' }];

  document.getElementById("moveModal").style.display = "flex";
  window.renderMoveDirectory();
};

window.navigateMoveFolder = function (id, name, pathIndex = -1) {
  moveCurrentFolderId = id === "null" ? null : id;
  if (pathIndex >= 0) {
    movePath = movePath.slice(0, pathIndex + 1);
  } else {
    movePath.push({ id, name });
  }
  window.renderMoveDirectory();
};

window.renderMoveDirectory = async function () {
  const gridEl = document.getElementById("moveGridArea");
  const bcEl = document.getElementById("moveBreadcrumb");
  const targetLabel = document.getElementById("moveTargetLabel");
  const user = auth.currentUser;

  if (!user) return;

  // Render Breadcrumb
  let bcHtml = "";
  movePath.forEach((item, index) => {
    if (index > 0) bcHtml += `<span class="bc-separator">/</span>`;
    bcHtml += `<span class="bc-item" onclick="window.navigateMoveFolder('${item.id}', '${item.name}', ${index})">${item.name}</span>`;
  });
  bcEl.innerHTML = bcHtml;

  targetLabel.innerHTML = `📍 Đang chọn: <b>${movePath[movePath.length - 1].name}</b>`;

  gridEl.innerHTML = `<div class="drive-skeleton-grid" style="padding:15px">
                        <div class="cloud-skeleton"></div>
                        <div class="cloud-skeleton"></div>
                      </div>`;

  try {
    const snap = await db.collection("users").doc(user.uid).collection("folders")
      .where("parentId", "==", moveCurrentFolderId)
      .get();

    let html = "";
    if (moveCurrentFolderId !== null) {
      // Nút quay lại
      html += `
        <div class="cloud-item type-folder" onclick="window.navigateMoveFolder('${movePath[movePath.length - 2].id}', '', ${movePath.length - 2})">
          <div class="icon-box">⬅️</div>
          <div class="cloud-name">Quay lại</div>
        </div>`;
    }

    snap.forEach(doc => {
      const d = doc.data();
      // Không cho phép di chuyển folder vào chính nó
      if (movingItemType === 'folder' && doc.id === movingItemId) return;

      html += `
        <div class="cloud-item type-folder" onclick="window.navigateMoveFolder('${doc.id}', '${d.name.replace(/'/g, "\\'")}')">
          <div class="icon-box">📁</div>
          <div class="cloud-name">${d.name}</div>
        </div>`;
    });

    gridEl.innerHTML = html || "<div style='text-align:center; padding:20px; color:var(--text-muted, #94a3b8);'>Không có thư mục con</div>";

    const btnConfirm = document.getElementById("btnConfirmMove");

    // KIỂM TRA LOGIC: Nếu đích đến trùng với nguồn -> Vô hiệu hóa nút
    const isSameDestination = (moveCurrentFolderId === movingItemSourceParentId);

    if (isSameDestination) {
      btnConfirm.disabled = true;
      btnConfirm.textContent = "Đã ở đây";
      btnConfirm.style.background = "";
      btnConfirm.style.cursor = "";
    } else {
      btnConfirm.disabled = false;
      btnConfirm.textContent = "Xác nhận chuyển";
      btnConfirm.style.background = "";
      btnConfirm.style.cursor = "";
    }

    btnConfirm.onclick = async () => {
      cloudAlert({ type: 'loading', title: 'Đang di chuyển...', message: 'Vui lòng chờ' });
      try {
        const collection = movingItemType === 'file' ? 'examFiles' : 'folders';
        const field = movingItemType === 'file' ? 'folderId' : 'parentId';

        await db.collection("users").doc(user.uid).collection(collection).doc(movingItemId).update({
          [field]: moveCurrentFolderId
        });

        document.getElementById("moveModal").style.display = "none";
        window.closeCloudAlert();
        loadCloudDirectory();
      } catch (err) {
        window.closeCloudAlert();
        cloudAlert({ title: "Lỗi", message: err.message, icon: "❌" });
      }
    };
  } catch (err) {
    gridEl.innerHTML = "<div style='color:red'>Lỗi tải thư mục</div>";
  }
};

// --- QUẢN LÝ DROPDOWN MENU ---
window.showGlobalCloudMenu = function (e, id, type, name) {
  e.stopPropagation();

  const dropdown = document.getElementById("globalCloudDropdown");
  const overlay = document.getElementById("globalCloudDropdownOverlay");

  // Set content based on type
  if (type === 'folder') {
    dropdown.innerHTML = `
      <div class="dropdown-item" onclick="window.closeGlobalDropdown(); window.enterFolder('${id}', '${name}')">
        <span class="dropdown-icon">📂</span> Mở thư mục
      </div>
      <div class="dropdown-item" onclick="window.closeGlobalDropdown(); window.openMoveModal('${id}', 'folder', '${name}', '${currentFolderId}')">
        <span class="dropdown-icon">🚚</span> Di chuyển
      </div>
      <div class="dropdown-item delete" onclick="window.closeGlobalDropdown(); window.deleteFolder('${id}', '${name}')">
        <span class="dropdown-icon">🗑️</span> Xóa thư mục
      </div>
    `;
  } else {
    dropdown.innerHTML = `
      <div class="dropdown-item" onclick="window.closeGlobalDropdown(); window.selectDriveFile('${id}', '${name}')">
        <span class="dropdown-icon">📖</span> Mở đề thi
      </div>
      <div class="dropdown-item" onclick="window.closeGlobalDropdown(); window.openMoveModal('${id}', 'file', '${name}', '${currentFolderId}')">
        <span class="dropdown-icon">🚚</span> Di chuyển
      </div>
      <div class="dropdown-item delete" onclick="window.closeGlobalDropdown(); window.deleteDriveFile('${id}', '${name}')">
        <span class="dropdown-icon">🗑️</span> Xóa đề thi
      </div>
    `;
  }

  // Show elements first so we get accurate dimensions if needed
  dropdown.style.display = "flex";
  dropdown.classList.add('active');
  overlay.style.display = "block";

  // Position the dropdown exactly where the mouse clicked
  const clickX = e.clientX;
  const clickY = e.clientY;
  const dropdownWidth = 160;
  const dropdownHeight = 130; // Approx height for 3 items

  // By default, open below and slightly left of the cursor
  let leftPos = clickX - dropdownWidth + 20;
  if (leftPos < 10) leftPos = 10;

  let topPos = clickY + 15;
  // If too low, flip it above the cursor
  if (topPos + dropdownHeight > window.innerHeight) {
    topPos = clickY - dropdownHeight - 15;
  }

  // Set position directly and explicitly remove right/bottom
  dropdown.style.top = topPos + "px";
  dropdown.style.left = leftPos + "px";
  dropdown.style.right = "auto";
  dropdown.style.bottom = "auto";
  dropdown.style.zIndex = "99999";
  overlay.style.zIndex = "99998";
};

window.closeGlobalDropdown = function () {
  const dropdown = document.getElementById("globalCloudDropdown");
  const overlay = document.getElementById("globalCloudDropdownOverlay");
  dropdown.style.display = "none";
  dropdown.classList.remove('active');
  overlay.style.display = "none";
};

// Đóng menu khi click ra ngoài
document.addEventListener('click', () => {
  window.closeGlobalDropdown();
});

// ==========================================
// FOLDER & FILE LOGIC — HELPERS
// ==========================================
window.setCloudLoading = function (show, message = "Đang xử lý...") {
  const loadingEl = document.getElementById("driveLoading");
  if (!loadingEl) return;

  if (show) {
    loadingEl.style.display = "block";
  } else {
    loadingEl.style.display = "none";
  }
};

// ==========================================
// FOLDER & FILE LOGIC — DRAG & DROP
// ==========================================

// Tạo thư mục mới
window.promptCreateFolder = async function () {
  const user = auth.currentUser;
  if (!user) return cloudAlert({ title: "Lỗi", message: "Vui lòng đăng nhập!", icon: "❌" });

  const name = await cloudAlert({
    type: 'prompt',
    title: 'Tạo thư mục mới',
    message: 'Nhập tên thư mục:',
    icon: '📁',
    confirmText: 'Tạo'
  });

  if (!name || !name.trim()) return;

  window.setCloudLoading(true, "Đang tạo thư mục...");
  try {
    await db.collection("users").doc(user.uid).collection("folders").add({
      name: name.trim(),
      parentId: currentFolderId,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    window.setCloudLoading(false);
    loadCloudDirectory();
  } catch (e) {
    window.setCloudLoading(false);
    cloudAlert({ title: "Lỗi tạo thư mục", message: e.message, icon: "❌" });
  }
};

// Lưu file JSON lên Firestore của user
async function uploadJsonToCloud(file, displayName) {
  window.setCloudLoading(true, "Đang tải file lên...");

  try {
    const user = auth.currentUser;
    if (!user) throw new Error("Bạn chưa đăng nhập!");

    // Đọc và Validate JSON
    const text = await file.text();
    JSON.parse(text); // Sẽ throw lỗi nếu file không phải JSON hợp lệ

    // Kiểm tra kích thước (Firestore giới hạn ~1MB/document, file JSON thường < 100KB)
    if (text.length > 900000) {
      throw new Error("File quá lớn! (Tối đa ~900KB)");
    }

    const statusEl = document.getElementById("driveUploadStatus");
    if (statusEl) {
      statusEl.style.display = "block";
      statusEl.innerHTML = `<div class="drive-spinner-small"></div> Đang lưu lên Cloud...`;
    }

    // Lưu thẳng vào Firestore
    await db
      .collection("users")
      .doc(user.uid)
      .collection("examFiles")
      .add({
        displayName: displayName || file.name.replace(/\.json$/i, ""),
        fileName: file.name,
        content: text, // Lưu nội dung JSON dưới dạng chuỗi
        folderId: currentFolderId,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });

    window.setCloudLoading(false);
    cloudAlert({ title: 'Thành công', message: `Tải lên thành công: ${displayName}`, icon: '✅' });

    // Tự ẩn thông báo sau 2s
    setTimeout(() => {
      window.closeCloudAlert();
    }, 2000);

    // Refresh danh sách
    loadCloudDirectory();
  } catch (e) {
    console.error("Upload error:", e);
    window.setCloudLoading(false);
    cloudAlert({ title: 'Lỗi tải lên', message: e.message, icon: '❌' });
  }
}

// Tải nội dung file JSON từ Firestore
async function loadCloudFile(docId, displayName) {
  const btn = document.getElementById("btnSelectDrive");
  const oldText = btn.textContent;
  btn.textContent = "⏳ Đang tải...";
  btn.disabled = true;

  try {
    const user = auth.currentUser;
    if (!user) throw new Error("Chưa đăng nhập");

    const docRef = db.collection("users").doc(user.uid).collection("examFiles").doc(docId);
    const docSnap = await docRef.get();

    if (!docSnap.exists) throw new Error("Không tìm thấy đề thi này!");

    const data = docSnap.data();
    const json = JSON.parse(data.content);

    document.getElementById("driveModal").style.display = "none";
    handleDataLoaded(json, displayName);
  } catch (e) {
    cloudAlert({ title: "Lỗi", message: "Không mở được file: " + e.message, icon: "❌" });
  } finally {
    btn.textContent = oldText;
    btn.disabled = false;
  }
}

// Tải nội dung file JSON từ Drive dùng access token
async function loadDriveFileWithToken(driveFileId, displayName) {
  const btn = document.getElementById("btnSelectDrive");
  const oldText = btn.textContent;
  btn.textContent = "⏳ Đang tải...";
  btn.disabled = true;
  try {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`,
      { headers: { Authorization: `Bearer ${driveAccessToken}` } }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    document.getElementById("driveModal").style.display = "none";
    handleDataLoaded(json, displayName);
  } catch (e) {
    cloudAlert({ title: "Lỗi", message: "Không tải được file từ Drive: " + e.message, icon: "❌" });
  } finally {
    btn.textContent = oldText;
    btn.disabled = false;
  }
}

// Tải danh sách Folders và Files trong thư mục hiện tại
async function loadCloudDirectory() {
  const gridEl = document.getElementById("cloudGridArea");
  const loadingEl = document.getElementById("driveLoading");
  const user = auth.currentUser;

  if (!user) {
    gridEl.innerHTML = `<div class="cloud-empty">⚠️ Vui lòng <b>đăng nhập</b> để xem kho đề của bạn.</div>`;
    return;
  }

  loadingEl.style.display = "block";
  gridEl.innerHTML = "";

  try {
    // 1. Lấy Folders
    let foldersQuery = db.collection("users").doc(user.uid).collection("folders");
    if (currentFolderId === null) foldersQuery = foldersQuery.where("parentId", "==", null);
    else foldersQuery = foldersQuery.where("parentId", "==", currentFolderId);

    const foldersSnap = await foldersQuery.get();

    // 2. Lấy Files (Bỏ orderBy để tránh lỗi Firebase requires an index)
    let filesQuery = db.collection("users").doc(user.uid).collection("examFiles");
    if (currentFolderId === null) filesQuery = filesQuery.where("folderId", "==", null);
    else filesQuery = filesQuery.where("folderId", "==", currentFolderId);

    const filesSnap = await filesQuery.get();

    loadingEl.style.display = "none";

    if (foldersSnap.empty && filesSnap.empty) {
      gridEl.innerHTML = `
        <div class="cloud-empty">
          <span style="font-size:64px; color:#cbd5e1; display:block; margin-bottom:10px;">📂</span>
          <p>Thư mục trống. Hãy <b>Tạo thư mục</b> hoặc <b>Tải lên</b> đề thi mới.</p>
        </div>`;
      return;
    }

    // Sắp xếp Folders theo tên (A-Z)
    const foldersArray = [];
    foldersSnap.forEach(doc => foldersArray.push({ id: doc.id, ...doc.data() }));
    foldersArray.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    // Sắp xếp Files theo thời gian mới nhất (desc)
    const filesArray = [];
    filesSnap.forEach(doc => filesArray.push({ id: doc.id, ...doc.data() }));
    filesArray.sort((a, b) => {
      const tA = a.createdAt ? a.createdAt.toMillis() : 0;
      const tB = b.createdAt ? b.createdAt.toMillis() : 0;
      return tB - tA;
    });

    let html = "";

    // Render Folders
    foldersArray.forEach((d) => {
      const dateStr = d.createdAt ? new Date(d.createdAt.toDate()).toLocaleDateString("vi-VN") : "";
      html += `
        <div class="cloud-item type-folder" 
             onclick="window.enterFolder('${d.id}', '${d.name.replace(/'/g, "\\'")}')"
             draggable="true"
             ondragstart="window.handleItemDragStart(event, '${d.id}', 'folder')"
             ondragend="window.handleItemDragEnd(event)"
             ondragover="window.handleItemDragOver(event, this)"
             ondragleave="window.handleItemDragLeave(event, this)"
             ondrop="window.handleItemDrop(event, '${d.id}')">
          <div class="icon-box">📁</div>
          <div class="cloud-name">${d.name}</div>
          
          <div class="cloud-item-menu" onclick="event.stopPropagation()">
            <button class="btn-menu-dots" onclick="window.showGlobalCloudMenu(event, '${d.id}', 'folder', '${d.name.replace(/'/g, "\\'")}')">⋮</button>
          </div>
        </div>`;
    });

    // Render Files
    filesArray.forEach((d) => {
      const dateStr = d.createdAt ? new Date(d.createdAt.toDate()).toLocaleDateString("vi-VN") : "";
      html += `
        <div class="cloud-item" 
             onclick="window.selectDriveFile('${d.id}', '${d.displayName.replace(/'/g, "\\'")}')"
             draggable="true" 
             ondragstart="window.handleItemDragStart(event, '${d.id}', 'file')"
             ondragend="window.handleItemDragEnd(event)">
          <div class="icon-box">📋</div>
          <div class="cloud-name" title="${d.displayName}">${d.displayName}</div>
          
          <div class="cloud-item-menu" onclick="event.stopPropagation()">
            <button class="btn-menu-dots" onclick="window.showGlobalCloudMenu(event, '${d.id}', 'file', '${d.displayName.replace(/'/g, "\\'")}')">⋮</button>
          </div>
        </div>`;
    });

    gridEl.innerHTML = html;

    // Thiet lap root-drop handler tren cloudBody
    const cloudBodyEl = document.getElementById("cloudBody");
    if (cloudBodyEl) {
      cloudBodyEl.ondragover = window.handleRootDragOver;
      cloudBodyEl.ondragleave = window.handleRootDragLeave;
      cloudBodyEl.ondrop = window.handleRootDrop;
    }

  } catch (e) {
    loadingEl.style.display = "none";
    gridEl.innerHTML = `<div class="cloud-empty" style="color:#dc2626">❌ Lỗi tải dữ liệu: ${e.message}</div>`;
  }
}

// Mo mot thu muc (Click vao thu muc) - voi bao ve chong click sau drag
window.enterFolder = function (folderId, folderName) {
  // Neu vua ket thuc keo tha, bo qua click
  if (_dragJustHappened) {
    _dragJustHappened = false;
    return;
  }
  currentFolderId = folderId;
  cloudPath.push({ id: folderId, name: folderName });
  renderBreadcrumb();
  loadCloudDirectory();
};

// Đệ quy xóa Folder và tất cả nội dung bên trong
async function recursiveDeleteFolder(userId, folderId) {
  // 1. Tìm và xóa các folder con
  const subFolders = await db.collection("users").doc(userId).collection("folders").where("parentId", "==", folderId).get();
  for (const doc of subFolders.docs) {
    await recursiveDeleteFolder(userId, doc.id);
  }

  // 2. Tìm và xóa các files trong folder này
  const filesSnap = await db.collection("users").doc(userId).collection("examFiles").where("folderId", "==", folderId).get();
  for (const doc of filesSnap.docs) {
    await doc.ref.delete();
  }

  // 3. Xóa chính folder này
  await db.collection("users").doc(userId).collection("folders").doc(folderId).delete();
}

// Xóa thư mục
window.deleteFolder = async function (folderId, folderName) {
  const confirmObj = await cloudAlert({
    type: 'confirm',
    title: 'Xóa thư mục',
    message: `Bạn có chắc muốn xóa thư mục "${folderName}"?\nToàn bộ thư mục con và đề thi bên trong cũng sẽ bị xóa!`,
    icon: '🗑️'
  });
  if (!confirmObj) return;

  const user = auth.currentUser;
  window.setCloudLoading(true, "Đang xóa thư mục...");

  try {
    await recursiveDeleteFolder(user.uid, folderId);
    window.setCloudLoading(false);
    loadCloudDirectory();
  } catch (e) {
    window.setCloudLoading(false);
    cloudAlert({ title: 'Lỗi xóa thư mục', message: e.message, icon: '❌' });
  }
};

// Chọn file để thi
window.selectDriveFile = function (docId, displayName) {
  loadCloudFile(docId, displayName);
};

// Xóa file khỏi Firestore
window.deleteDriveFile = async function (firestoreDocId, displayName) {
  const confirmObj = await cloudAlert({
    type: 'confirm',
    title: 'Xóa đề thi',
    message: `Xóa đề "${displayName}" khỏi kho của bạn?`,
    icon: '🗑️'
  });
  if (!confirmObj) return;

  const user = auth.currentUser;
  window.setCloudLoading(true, "Đang xóa đề thi...");
  try {
    await db.collection("users").doc(user.uid).collection("examFiles").doc(firestoreDocId).delete();
    window.setCloudLoading(false);
    loadCloudDirectory();
  } catch (e) {
    window.setCloudLoading(false);
    cloudAlert({ title: 'Lỗi xóa đề', message: e.message, icon: '❌' });
  }
};

// Mở modal
window.chooseExamFromDriveFolder = function () {
  const modal = document.getElementById("driveModal");
  modal.style.display = "flex";

  // Reset path về root khi mở modal
  currentFolderId = null;
  cloudPath = [{ id: null, name: 'Kho Đề' }];
  renderBreadcrumb();
  loadCloudDirectory();
};

// Giữ lại hàm cũ để tránh lỗi reference (nếu còn sót trong index.html)
function loadJsonFromDriveFileId(fileId, fileName) {
  loadCloudFile(fileId, fileName);
}

window.openQuestionNav = function () {
  document.getElementById("questionNavOverlay").classList.add("open");
};
window.closeQuestionNav = function () {
  document.getElementById("questionNavOverlay").classList.remove("open");
};

function generateQuiz() {
  const quizDiv = document.getElementById("quiz");
  quizDiv.innerHTML = "";

  // Reset Progress Bar
  updateProgressBar();

  const letters = ["A", "B", "C", "D", "E", "F"];
  const fragment = document.createDocumentFragment();

  questionsData.forEach((q, index) => {
    const card = document.createElement("div");
    card.className = "question-card";
    card.dataset.index = index;

    let html = `
      <div class="question-header">
        <span>📝 Câu ${index + 1}</span>
        <small>${index + 1}/${questionsData.length}</small>
      </div>
      <div class="question-text">${q.question}</div>
      <div class="options">
    `;
    (q.options || []).forEach((opt, i) => {
      const letter = letters[i] || "?";
      html += `
        <div class="option-wrapper">
          <input type="radio" name="q${index}" value="${opt.replace(/"/g, '&quot;')}" id="q${index}_opt${i}" class="option-input" style="display:none">
          <label for="q${index}_opt${i}" class="option-label">
            <span class="option-label-marker">${letter}</span>
            <span>${opt}</span>
          </label>
        </div>`;
    });
    html += `</div>`;

    // Thêm explain container cho TẤT CẢ câu có field explain
    // Ẩn mặc định, hiện sau khi chọn đáp án (review) hoặc sau khi nộp bài (thi thường)
    if (q.explain) {
      html += `<div class="review-explain" id="explain-${index}" style="display:none;">
        💡 <b>Giải thích:</b> ${q.explain}
      </div>`;
    }

    // Nút hỏi AI (ẩn mặc định, chỉ hiện sau khi nộp bài)
    html += `
      <div class="post-grade-actions" id="actions-${index}" style="display:none;">
        <button class="btn-ask-ai" onclick="window.askAIForQuestion(${index})">💬 Trò chuyện với AI</button>
      </div>
    `;

    card.innerHTML = html;
    fragment.appendChild(card);

    // SỰ KIỆN CHỌN ĐÁP ÁN

    card.querySelectorAll("input").forEach((inp) => {
      inp.addEventListener("change", () => {
        // 1. Cập nhật menu bên phải (Tối ưu truy vấn DOM)
        const btn = document.querySelector(`.qnav-item[data-index="${index}"]`);
        if (btn) {
          const currentActive = document.querySelector(".qnav-item.nav-active");
          if (currentActive && currentActive !== btn) {
            currentActive.classList.remove("nav-active");
          }
          btn.classList.add("nav-answered", "nav-active");
        }

        // 2. Cập nhật thanh tiến độ
        updateProgressBar();

        // 3. LOGIC RIÊNG CHO CHẾ ĐỘ ÔN TẬP (Review Mode)
        if (isReviewMode) {
          const userVal = inp.value;
          const correctVal = (q.answer || "").trim();
          const labels = card.querySelectorAll(".option-label");
          const currentExamName =
            document.getElementById("examName").textContent;
          card.querySelectorAll("input").forEach((i) => (i.disabled = true));
          card.classList.add("locked-card");
          // Xóa màu cũ
          labels.forEach((l) => l.classList.remove("correct", "incorrect"));

          // Tạo div phản hồi nếu chưa có
          let feedback = document.getElementById(`feedback-${index}`);
          if (!feedback) {
            feedback = document.createElement("div");
            feedback.id = `feedback-${index}`;
            feedback.style.marginTop = "15px";
            feedback.style.fontWeight = "bold";
            feedback.style.padding = "10px";
            feedback.style.borderRadius = "8px";
            card.appendChild(feedback);
          }
          feedback.innerHTML = "⏳ Đang đồng bộ Cloud...";
          feedback.style.background = "#f1f5f9";

          if (userVal === correctVal) {
            // --- TRƯỜNG HỢP ĐÚNG ---
            inp.nextElementSibling.classList.add("correct");
            if (btn) btn.classList.add("nav-correct");

            // Gọi Firebase trừ điểm
            updateMistakeInCloud(currentExamName, q.question, true)
              .then((remaining) => {
                // --- SỬA: Xử lý nếu gặp lỗi (-1) ---
                if (remaining === -1) {
                  feedback.style.background = "#fee2e2";
                  feedback.innerHTML = `<span style="color:#dc2626">⚠️ Lỗi kết nối! Chưa cập nhật được lên Cloud.</span>`;
                  return;
                }
                // -----------------------------------

                if (remaining > 0) {
                  feedback.style.background = "#fff7ed"; // Cam nhạt
                  feedback.innerHTML = `<span style="color:#c2410c">👏 Đúng rồi! Nhưng bạn vẫn còn nợ câu này <b>${remaining}</b> lần nữa.</span>`;
                } else {
                  feedback.style.background = "#f0fdf4"; // Xanh nhạt
                  feedback.innerHTML = `<span style="color:#16a34a">🎉 Xuất sắc! Đã xóa câu này khỏi danh sách sai trên Cloud.</span>`;
                }
              })
              .catch((err) => {
                // Phòng hờ lỗi không mong muốn
                feedback.innerHTML = "⚠️ Lỗi hệ thống. Vui lòng thử lại.";
              });
          } else {
            // --- TRƯỜNG HỢP SAI ---
            inp.nextElementSibling.classList.add("incorrect");
            if (btn) btn.classList.add("nav-incorrect");

            // Hiện đáp án đúng
            card.querySelectorAll("input").forEach((optInp) => {
              if (optInp.value === correctVal)
                optInp.nextElementSibling.classList.add("correct");
            });

            // SỬA LỖI Ở ĐÂY: Dùng updateMistakeInCloud và .then()
            updateMistakeInCloud(currentExamName, q.question, false).then(
              () => {
                feedback.style.background = "#fef2f2"; // Đỏ nhạt
                feedback.innerHTML = `<span style="color:#dc2626">⚠️ Sai rồi! Đã bị cộng thêm 1 lần phạt vào lịch sử.</span>`;
              }
            );
          }

          // Hiện giải thích
          const explainDiv = document.getElementById(`explain-${index}`);
          if (explainDiv) explainDiv.style.display = "block";
        }
      });
    });
  });
  
  quizDiv.appendChild(fragment);

  // Render Nav List (Giữ nguyên logic cũ)
  const listEl = document.getElementById("questionList");
  listEl.innerHTML = "";
  questionsData.forEach((_, i) => {
    const btn = document.createElement("button");
    btn.className = "qnav-item";
    btn.textContent = i + 1;
    btn.dataset.index = i;
    btn.onclick = () => {
      const card = document.querySelector(`.question-card[data-index="${i}"]`);
      const activeItem = document.querySelector(".qnav-item.nav-active");
      if (activeItem) activeItem.classList.remove("nav-active");
      btn.classList.add("nav-active");
      if (card) {
        card.scrollIntoView({ behavior: "smooth", block: "center" });
        card.classList.remove("active-highlight");
        void card.offsetWidth;
        card.classList.add("active-highlight");
        setTimeout(() => card.classList.remove("active-highlight"), 1500);
      }
      if (window.innerWidth <= 850) closeQuestionNav();
    };
    listEl.appendChild(btn);
  });
}

// Hàm phụ cập nhật thanh tiến độ
function updateProgressBar() {
  const total = questionsData.length;
  if (total === 0) return;
  const answered = document.querySelectorAll(
    'input[type="radio"]:checked'
  ).length;
  const percent = (answered / total) * 100;
  const bar = document.getElementById("examProgressBar");
  if (bar) bar.style.width = `${percent}%`;
  const activeBar = document.getElementById("activeProgressBar");
  if (activeBar) activeBar.style.width = `${percent}%`;
}

function grade(autoSubmit) {
  if (!questionsData.length) return;
  if (examFinished) return;

  examFinished = true;
  clearInterval(timerInterval);

  document.getElementById("btnGradeHeader").style.display = "none";
  document.getElementById("btnGradeNav").style.display = "none";
  const activeGrade = document.getElementById("btnActiveGrade");
  if (activeGrade) activeGrade.style.display = "none";

  let score = 0;
  document
    .querySelectorAll(".qnav-item")
    .forEach((b) => (b.className = "qnav-item"));

  // --- CHUẨN BỊ BATCH FIREBASE ---
  const batch = db.batch();
  const user = auth.currentUser;
  let hasMistakesToSave = false;
  const currentExamName = document.getElementById("examName").textContent;
  let mistakeDocRef = null;

  if (user && currentExamName) {
    const safeId = getSafeId(currentExamName);
    mistakeDocRef = db
      .collection("users")
      .doc(user.uid)
      .collection("mistake_tracking")
      .doc(safeId);
  }
  // -------------------------------

  questionsData.forEach((q, i) => {
    const card = document.querySelector(`.question-card[data-index="${i}"]`);
    const selected = document.querySelector(`input[name="q${i}"]:checked`);
    const navBtn = document.querySelector(`.qnav-item[data-index="${i}"]`);
    const correctText = normalizeText(q.answer);
    const userText = selected ? normalizeText(selected.value) : "";
    const isCorrect = userText === correctText && userText !== "";

    // --- LƯU CÂU SAI VÀO BATCH ---
    if (!isCorrect && user && mistakeDocRef) {
      const qKey = encodeKey(q.question);
      batch.set(
        mistakeDocRef,
        {
          [qKey]: firebase.firestore.FieldValue.increment(1),
          last_updated: firebase.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      hasMistakesToSave = true;
    }
    // -----------------------------

    const opts = q.options || [];
    card.classList.remove("correct", "incorrect");
    card.querySelectorAll(".option-label").forEach((lbl, idx) => {
      const optText = normalizeText(opts[idx]);
      if (optText === correctText && correctText !== "")
        lbl.classList.add("correct");
      if (selected && optText === userText && !isCorrect)
        lbl.classList.add("incorrect");
    });
    card.querySelectorAll("input").forEach((inp) => (inp.disabled = true));
    if (isCorrect) {
      score++;
      card.classList.add("correct");
      if (navBtn) navBtn.classList.add("nav-correct");
    } else {
      card.classList.add("incorrect");
      if (navBtn) navBtn.classList.add("nav-incorrect");
    }

    // Hien badge trang thai
    const badge = document.createElement("div");
    badge.className = "q-status-badge";
    if (!selected) {
      badge.textContent = "Ch\u01b0a tr\u1ea3 l\u1eddi";
      badge.classList.add("q-status-unanswered");
    } else if (isCorrect) {
      badge.textContent = "Ch\u00ednh x\u00e1c";
      badge.classList.add("q-status-correct");
    } else {
      badge.textContent = "Sai";
      badge.classList.add("q-status-incorrect");
    }
    card.appendChild(badge);

    // Hien khu vuc hanh dong AI
    const actionArea = document.getElementById(`actions-${i}`);
    if (actionArea) actionArea.style.display = "flex";

    // Hien explain sau khi cham bai
    if (q.explain) {
      let explainEl = document.getElementById(`explain-${i}`);
      if (!explainEl) {
        explainEl = document.createElement("div");
        explainEl.className = "review-explain";
        explainEl.innerHTML = `\u1f4a1 <b>Gi\u1ea3i th\u00edch:</b> ${q.explain}`;
        card.appendChild(explainEl);
      }
      explainEl.style.display = "block";
    }
  }); // end questionsData.forEach

  // --- GUI BATCH LEN CLOUD ---
  if (hasMistakesToSave) {
    batch
      .commit()
      .then(() => console.log("\u2601\ufe0f \u0110\xe3 l\u01b0u c\xe1c c\xe2u sai v\xe0o Firebase"));
  }
  // ---------------------------
  if (score > 0) {
    gainXP(score * 10);
    console.log(`\u1f389 \u0110\xe3 c\u1ed9ng ${score * 10} XP`);
  }
  const total = questionsData.length;
  const percent = Math.round((score / total) * 100);
  let rank = percent >= 80 ? "Giỏi" : percent >= 50 ? "Khá" : "Yếu";
  if (percent >= 90) rank = "Xuất sắc";
  document.getElementById(
    "result"
  ).innerHTML = `<span style="font-size:18px;">Kết quả: <b>${score}/${total}</b> (${percent}%) - ${rank}</span>`;
  const topRes = document.getElementById("topResult");
  topRes.style.display = "block";
  topRes.textContent = `${percent}%`;
  window.scrollTo({ top: 0, behavior: "smooth" });

  saveExamResult(score, total, percent, currentExamName);
}

window.resetExam = async function () {
  if (examFinished) {
    pendingData = null;
    questionsData = [];
    // Reset topResult BEFORE showing mainHeader
    document.getElementById("topResult").style.display = "none";
    document.getElementById("topResult").textContent = "--%";
    setHeaderMode("setup");
    renderHomeScreen();
    document.getElementById("result").textContent = "";
    document.getElementById("btnGradeHeader").style.display = "none";
    document.getElementById("btnGradeNav").style.display = "none";
    const activeGrade = document.getElementById("btnActiveGrade");
    if (activeGrade) activeGrade.style.display = "inline-flex";
    updateFileStatus("", false);
    return;
  }

  const confirmExit = await cloudAlert({
    type: 'confirm',
    title: 'Xác nhận',
    message: 'Bạn muốn thoát bài này?',
    icon: '❓'
  });
  if (!confirmExit) return;

  clearInterval(timerInterval);
  examFinished = false;
  questionsData = [];
  pendingData = null;
  // Reset topResult BEFORE showing mainHeader
  document.getElementById("topResult").style.display = "none";
  document.getElementById("topResult").textContent = "--%";
  setHeaderMode("setup");
  updateFileStatus("", false);
  renderHomeScreen();
  document.getElementById("result").textContent = "";
  document.getElementById("examHistorySummary").style.display = "none";
  document.getElementById("questionList").innerHTML = "";
  closeQuestionNav();
};

// ========================
// FIREBASE
// ========================
auth.onAuthStateChanged((user) => {
  const btnLogin = document.getElementById("btnLogin");
  const userSection = document.getElementById("userSection");
  const avatar = document.getElementById("userAvatar");

  if (user) {
    document.body.classList.add("logged-in");
    btnLogin.style.display = "none";
    userSection.style.display = "flex";
    avatar.src =
      user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName}`;

    // --- MỚI: TỰ ĐỘNG TẢI KEY TỪ CLOUD VỀ ---
    syncKeysFromCloud(user);
    // ----------------------------------------
  } else {
    document.body.classList.remove("logged-in");
    btnLogin.style.display = "block";
    userSection.style.display = "none";
  }
});
document.getElementById("btnLogin").onclick = () =>
  auth.signInWithPopup(provider).catch((e) => {
    if (e.code !== "auth/popup-closed-by-user") {
      console.error("Login error:", e);
    }
  });
document.getElementById("btnLogout").onclick = () => auth.signOut();

async function saveExamResult(score, total, percent, examName) {
  const user = auth.currentUser;
  if (!user) return;
  const details = questionsData.map((q, i) => {
    const sel = document.querySelector(`input[name="q${i}"]:checked`);
    return {
      q:    q.question,
      u:    sel ? sel.value : "",
      a:    q.answer  || "",
      s:    sel && sel.value === (q.answer || ""),
      opts: Array.isArray(q.options) ? q.options : [],
      ex:   q.explain || "",
    };
  });
  try {
    await db
      .collection("users")
      .doc(user.uid)
      .collection("history")
      .add({
        examName: examName,
        score,
        total,
        percent,
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        dateStr: new Date().toLocaleString("vi-VN"),
        details,
      });
    fetchHistoryData(user.uid);
  } catch (e) { }
}

async function fetchHistoryData(uid) {
  try {
    const snap = await db
      .collection("users")
      .doc(uid)
      .collection("history")
      .orderBy("timestamp", "desc")
      .limit(100)
      .get();
    globalHistoryData = [];
    snap.forEach((d) => globalHistoryData.push({ id: d.id, ...d.data() }));
  } catch (e) { }
}

// ========================
// AI GIA SƯ LOGIC
// ========================

// Hàm hiển thị nội dung AI dựa trên lần làm bài được chọn
function renderAIContent(attemptData) {
  const aiResultBox = document.getElementById("aiResultBox");
  const aiContent = document.getElementById("aiContent");
  const aiBtn = document.getElementById("btnAnalyzeAI");
  const expandBtn = document.getElementById("btnExpandAI");
  const reAnalyzeBtn = document.getElementById("btnReAnalyzeAI");
  const loading = document.getElementById("aiLoading");

  aiResultBox.style.display = "none";
  aiResultBox.classList.remove("is-loading");
  if (loading) loading.style.display = "none";

  aiContent.innerHTML = "";
  expandBtn.style.display = "none";
  reAnalyzeBtn.style.display = "none";
  aiResultBox.classList.remove("modern-ai-ready", "modern-ai-empty");
  aiBtn.classList.add("modern-ai-action");

  if (attemptData.aiAnalysis) {
    aiResultBox.style.display = "block";
    aiResultBox.classList.add("modern-ai-ready");

    let cleanHtml = attemptData.aiAnalysis;
    cleanHtml = cleanHtml.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");

    aiContent.innerHTML = `
      <div class="modern-ai-report">
        <div class="modern-ai-report__head">
          <span>🤖</span>
          <div>
            <strong>Báo cáo AI đã sẵn sàng</strong>
            <small>Dựa trên lần làm bài bạn đang chọn</small>
          </div>
        </div>
        <div class="modern-ai-report__body">${cleanHtml}</div>
      </div>
    `;

    expandBtn.style.display = "inline-flex";
    reAnalyzeBtn.style.display = "inline-flex";
    aiBtn.textContent = "✅ Đã có phân tích";
    aiBtn.disabled = true;
    aiBtn.removeAttribute("style");
  } else {
    aiResultBox.style.display = "block";
    aiResultBox.classList.add("modern-ai-empty");
    aiContent.innerHTML = `
      <div class="modern-ai-placeholder">
        <span>🧠</span>
        <strong>Chưa có phân tích AI cho lần làm này</strong>
        <p>Nhấn nút bên phải để AI đọc các câu sai, tìm lỗ hổng kiến thức và gợi ý cách ôn lại.</p>
      </div>
    `;
    aiBtn.disabled = false;
    aiBtn.removeAttribute("style");
    aiBtn.textContent = "✨ Phân tích lỗi sai";

    const mistakes = (attemptData.details || []).filter((q) => !q.s);
    if (mistakes.length === 0) {
      aiBtn.textContent = "🎉 Lần này đúng 100%!";
      aiBtn.disabled = true;
      aiContent.innerHTML = `
        <div class="modern-ai-placeholder success">
          <span>🎉</span>
          <strong>Không có lỗi sai để phân tích</strong>
          <p>Lần làm này đạt 100%, bạn có thể xem lại timeline hoặc tiếp tục luyện đề khác.</p>
        </div>
      `;
    }
  }
}

// ========================
// HÀM GỌI AI (PHIÊN BẢN MỚI NHẤT)
// ========================
async function analyzeWithGemini(forceUpdate = false) {
  const aiBtn = document.getElementById("btnAnalyzeAI");
  const resultBox = document.getElementById("aiResultBox");
  const loading = document.getElementById("aiLoading");
  const content = document.getElementById("aiContent");
  const reAnalyzeBtn = document.getElementById("btnReAnalyzeAI");
  const aiSelect = document.getElementById("aiHistorySelect");

  // (BƯỚC MỚI: Người dùng chọn trực tiếp qua dropdown activeAIProviderSelect, 
  // không cần hiện cloudAlert khó chịu nữa)
  updateAIUI();

  // Lấy tên môn học từ UI
  const examNameElem = document.getElementById("examName");
  const currentExamName = examNameElem ? examNameElem.textContent : "Đề thi";

  const keys = AI_PROVIDER === "gemini" ? API_KEYS : GROQ_KEYS;
  if (!keys || keys.length === 0) {
    window.promptForKeys();
    return;
  }

  const selectedId = aiSelect.value;
  if (!selectedId) {
    cloudAlert({ title: "Thông báo", message: "Vui lòng chọn lần làm bài.", icon: "ℹ️" });
    return;
  }
  const targetAttempt = globalHistoryData.find((h) => h.id === selectedId);
  if (!targetAttempt) return;

  if (targetAttempt.aiAnalysis && !forceUpdate) {
    renderAIContent(targetAttempt);
    return;
  }

  const mistakes = targetAttempt.details.filter((q) => !q.s);
  if (mistakes.length === 0) {
    cloudAlert({ title: "Tuyệt vời", message: "Bạn đúng 100%! Không có gì để phân tích.", icon: "🎉" });
    return;
  }

  const limitedMistakes = mistakes.slice(0, 8);
  const mistakesJson = limitedMistakes.map((m) => ({
    question: m.q,
    userAnswer: m.u || "Bỏ trống",
    correctAnswer: m.a,
  }));

  resultBox.style.display = "block";
  resultBox.classList.remove("modern-ai-ready", "modern-ai-empty");
  resultBox.classList.add("modern-ai-ready", "is-loading");
  if (loading) loading.style.display = "flex";
  content.innerHTML = "";

  aiBtn.disabled = true;
  aiBtn.textContent = forceUpdate ? "♻️ Đang tổng hợp báo cáo..." : "⏳ Đang phân tích chuyên sâu...";
  reAnalyzeBtn.style.display = "none";

  // ÉP AI VIẾT THEO CẤU TRÚC ĐỂ UI RENDER THÀNH THẺ CHUẨN
  const prompt = `
    Bạn là một Chuyên gia Giáo dục cấp cao, am hiểu về môn học "${currentExamName || 'Trắc nghiệm'}".
    Hãy phân tích các lỗi sai của học sinh dựa trên dữ liệu JSON sau:
    
    Dữ liệu câu sai:
    ${JSON.stringify(mistakesJson, null, 2)}
    
    Yêu cầu trình bày theo cấu trúc Markdown khoa học sau:
    
    ### 🧐 NHẬN XÉT TỔNG QUAN
    (Nhận xét 2-3 câu về lỗ hổng kiến thức chính của học sinh)

    ### ❌ CHI TIẾT LỖI SAI
    (Dùng danh sách liệt kê để giải thích từng câu. Với mỗi câu, hãy bôi đậm **(từ khóa)** vào các khái niệm cốt lõi để học sinh dễ nhớ)

    > 💡 **LỜI KHUYÊN ÔN TẬP:** 
    > (Đưa ra 2 hành động cụ thể để khắc phục)
    
    Lưu ý: Trình bày bằng Tiếng Việt, giải thích đi thẳng vào trọng tâm, không lan man.
  `;

  const result = await callAI(prompt);

  if (result.text) {
    resultBox.classList.remove("is-loading");
    if (loading) loading.style.display = "none";
    let finalHtml = result.text;
    if (window.marked) finalHtml = marked.parse(result.text);

    // GẮN CLASS MARKDOWN-BODY VÀO ĐÂY ĐỂ CSS BẮT ĐẦU HOẠT ĐỘNG
    finalHtml = `
      <div class="markdown-body">
        ${finalHtml}
      </div>
      <div class="ai-model-footer">
          ⚡ Phân tích bởi: <span class="ai-model-badge">${AI_PROVIDER.toUpperCase()}</span>
      </div>
    `;

    targetAttempt.aiAnalysis = finalHtml;
    try {
      const user = auth.currentUser;
      if (user && targetAttempt.id) {
        await db.collection("users").doc(user.uid).collection("history").doc(targetAttempt.id).update({
          aiAnalysis: finalHtml,
        });
      }
    } catch (e) { console.error(e); }

    renderAIContent(targetAttempt);
  } else {
    resultBox.classList.remove("is-loading");
    content.innerHTML = `<p style="color:red; text-align:center; padding:20px;">❌ ${result.error}</p>`;
    aiBtn.disabled = false;
    aiBtn.textContent = "Thử lại";
    if (loading) loading.style.display = "none";
  }
}


// Gắn hàm vào nút bấm
document.getElementById("btnAnalyzeAI").onclick = analyzeWithGemini;

// ---------------------------------------------------------
// MỚI: HỎI AI VỀ MỘT CÂU HỎI CỤ THỂ
// ---------------------------------------------------------
// CORE: GỌI AI (GEMINI HOẶC GROQ) TRỰC TIẾP QUA REST API
// ---------------------------------------------------------
async function callAI(prompt, signal = null) {
  if (AI_PROVIDER === "gemini") {
    if (!API_KEYS || API_KEYS.length === 0) return { error: "Chưa có Key Gemini" };

    for (let i = 0; i < API_KEYS.length; i++) {
      const key = API_KEYS[currentKeyIndex];
      try {
        const modelNames = [
          "gemini-1.5-flash",         // Bản Flash ổn định nhất hiện nay
          "gemini-1.5-pro",           // Bản Pro ổn định và thông minh
          "gemini-2.0-flash-exp",     // Bản 2.0 experimental
          "gemini-flash-latest",      // Alias trỏ tới bản mới nhất
          "gemini-2.5-flash",         // Giữ lại theo yêu cầu người dùng
          "gemini-2.5-pro"            // Giữ lại theo yêu cầu người dùng
        ];
        let lastError = null;

        for (const mName of modelNames) {
          try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${mName}:generateContent?key=${key}`;
            const response = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
              }),
              signal: signal
            });

            const data = await response.json();

            if (!response.ok) {
              throw new Error(data.error?.message || `Lỗi HTTP ${response.status}`);
            }

            if (data.candidates && data.candidates[0].content.parts[0].text) {
              return { text: data.candidates[0].content.parts[0].text };
            } else {
              throw new Error("Phản hồi từ Gemini không hợp lệ.");
            }
          } catch (modelErr) {
            lastError = modelErr;
            console.warn(`Thử model ${mName} qua REST API thất bại:`, modelErr.message);
          }
        }
        throw lastError;
      } catch (e) {
        console.error(`Gemini Key ${currentKeyIndex} lỗi:`, e);
        rotateKey("gemini");
      }
    }
  } else if (AI_PROVIDER === "groq") {
    if (!GROQ_KEYS || GROQ_KEYS.length === 0) return { error: "Chưa có Key Groq" };

    for (let i = 0; i < GROQ_KEYS.length; i++) {
      const key = GROQ_KEYS[currentGroqKeyIndex];
      try {
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${key}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7
          }),
          signal: signal
        });
        const data = await response.json();
        if (data.choices && data.choices[0]) {
          return { text: data.choices[0].message.content };
        } else {
          throw new Error(data.error?.message || "Lỗi Groq");
        }
      } catch (e) {
        console.error(`Groq Key ${currentGroqKeyIndex} lỗi:`, e);
        rotateKey("groq");
      }
    }
  }
  return { error: "Tất cả các Key đều lỗi hoặc không hợp lệ." };
}

let aiAbortController = null;

window.askAIForQuestion = async function (index) {
  const q = questionsData[index];
  if (!q) return;

  const keys = AI_PROVIDER === "gemini" ? API_KEYS : GROQ_KEYS;
  if (!keys || keys.length === 0) {
    window.promptForKeys();
    return;
  }

  const qKey = getSmartKey(q.question);
  window.openAIChatModal(qKey, {
    question: q.question || "",
    options: Array.isArray(q.options) ? q.options : [],
    answer: q.answer || "",
    explain: q.explain || "",
  });
};

// Hàm phụ để hiển thị kết quả AI (tránh lặp code)
function showAIResult(index, questionText, htmlContent) {
  const aiBox = document.getElementById("aiResultBox");
  const content = document.getElementById("aiContent");
  const loading = document.getElementById("aiLoading");

  if (!aiBox.classList.contains("expanded")) {
    document.body.appendChild(aiBox);
    aiBox.classList.add("expanded");
    document.body.classList.add("ai-open");
  }
  
  aiBox.style.display = "block";
  aiBox.classList.remove("is-loading");
  if (loading) loading.style.display = "none";

  content.innerHTML = `
    <div class="ai-question-analysis" style="animation: fadeIn 0.4s ease;">
      <div class="q-analysis-header">
        <h4>🤖 GIẢI ĐÁP BỞI ${AI_PROVIDER.toUpperCase()} - CÂU ${index + 1}:</h4>
        <p>${questionText}</p>
      </div>
      
      <div class="markdown-body">
        ${htmlContent}
      </div>
      
      <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid var(--border); text-align: center;">
          <button class="btn-cloud-action" onclick="document.getElementById('btnCloseExpanded').click()" style="background:#3b82f6; color:white; border:none; padding: 10px 24px; font-size: 15px;">Đã hiểu, quay lại</button>
      </div>
    </div>
  `;
}

// ========================
// CHART & THỐNG KÊ
// ========================

function renderChart(examName, data) {
  const chartBox = document.getElementById("chartContainer");
  const statsBox = document.getElementById("chartStats");
  const msgBox = document.getElementById("chartMessage");
  const canvas = document.getElementById("scoreChart");
  const ctx = canvas ? canvas.getContext("2d") : null;

  let myHist = data.filter(
    (h) => h.examName === examName || h.examName.includes(examName)
  );

  const getTime = (item) => {
    if (!item) return 0;
    if (item.timestamp?.seconds) return item.timestamp.seconds * 1000;
    if (typeof item.timestamp === "number") return item.timestamp;
    if (item.date) return new Date(item.date).getTime() || 0;
    if (item.dateStr) return new Date(item.dateStr).getTime() || 0;
    return 0;
  };

  myHist.sort((a, b) => getTime(b) - getTime(a));

  if (!myHist.length) {
    if (chartBox) chartBox.style.display = "none";
    if (statsBox) {
      statsBox.style.display = "grid";
      statsBox.innerHTML = `<div class="modern-empty-state">📭 Chưa có dữ liệu làm bài cho đề này.</div>`;
    }
    if (msgBox) msgBox.style.display = "none";
    return;
  }

  const recentAttempt = myHist[0];
  const bestAttempt = [...myHist].sort((a, b) => (b.percent || 0) - (a.percent || 0))[0];
  const oldestAttempt = myHist[myHist.length - 1];
  const avgPercent = Math.round(myHist.reduce((sum, h) => sum + (h.percent || 0), 0) / myHist.length);
  const avgWrong = Math.round(myHist.reduce((sum, h) => sum + Math.max((h.total || 0) - (h.score || 0), 0), 0) / myHist.length);
  const delta = (recentAttempt.percent || 0) - (oldestAttempt.percent || 0);
  const deltaLabel = delta > 0 ? `+${delta}%` : `${delta}%`;
  const trendText = delta > 0 ? "Đang tiến bộ" : delta < 0 ? "Cần kéo lại nhịp" : "Ổn định";
  const trendIcon = delta > 0 ? "📈" : delta < 0 ? "📉" : "➖";

  if (statsBox) {
    statsBox.style.display = "grid";
    statsBox.innerHTML = `
      <div class="modern-stat-card accent-blue">
        <span>🎯 Lần gần nhất</span>
        <strong>${recentAttempt.percent || 0}%</strong>
        <small>${recentAttempt.score || 0}/${recentAttempt.total || 0} câu đúng</small>
      </div>
      <div class="modern-stat-card accent-green">
        <span>🏆 Cao nhất</span>
        <strong>${bestAttempt.percent || 0}%</strong>
        <small>${bestAttempt.score || 0}/${bestAttempt.total || 0} câu đúng</small>
      </div>
      <div class="modern-stat-card accent-amber">
        <span>${trendIcon} Xu hướng</span>
        <strong>${deltaLabel}</strong>
        <small>${trendText}</small>
      </div>
      <div class="modern-stat-card accent-red">
        <span>🧩 Sai trung bình</span>
        <strong>${avgWrong}</strong>
        <small>Khoảng ${avgPercent}% trung bình</small>
      </div>
    `;
  }

  if (!ctx || typeof Chart === "undefined" || myHist.length < 2) {
    if (chartBox) chartBox.style.display = "none";
    if (msgBox) {
      msgBox.style.display = "block";
      msgBox.innerHTML = "📊 Cần ít nhất 2 lần làm bài để vẽ đường tiến bộ.";
    }
  } else {
    if (chartBox) chartBox.style.display = "block";
    if (msgBox) msgBox.style.display = "none";
    const chartData = [...myHist].reverse();
    const labels = chartData.map((_, index) => `Lần ${index + 1}`);
    const percents = chartData.map((h) => h.percent || 0);
    const scores = chartData.map((h) => `${h.score || 0}/${h.total || 0}`);

    if (scoreChart) {
      scoreChart.destroy();
    }
    scoreChart = new Chart(ctx, {
      type: "line",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Tỷ lệ đúng",
            data: percents,
            borderColor: "#3b82f6",
            backgroundColor: "rgba(59, 130, 246, 0.14)",
            borderWidth: 3,
            pointBackgroundColor: "#2563eb",
            pointBorderColor: "#ffffff",
            pointBorderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 7,
            tension: 0.38,
            fill: true,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => `${context.parsed.y}% (${scores[context.dataIndex]})`,
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            suggestedMax: 100,
            max: 100,
            ticks: { callback: (value) => `${value}%`, stepSize: 20 },
            grid: { color: "#f1f5f9" },
          },
          x: { grid: { display: false }, ticks: { maxRotation: 0 } },
        },
      },
    });
  }

  const aiSelect = document.getElementById("aiHistorySelect");

  if (myHist.length > 0) {
    let optionsHtml = "";
    myHist.forEach((attempt, index) => {
      const time = attempt.dateStr || "N/A";
      optionsHtml += `<option value="${attempt.id}">📅 ${time} (Điểm: ${attempt.score}/${attempt.total})</option>`;
    });
    aiSelect.innerHTML = optionsHtml;
    aiSelect.selectedIndex = 0;
    renderAIContent(myHist[0]);

    aiSelect.onchange = function () {
      const selectedId = this.value;
      const selectedAttempt = myHist.find((h) => h.id === selectedId);
      if (selectedAttempt) {
        renderAIContent(selectedAttempt);
      }
    };
  } else {
    aiSelect.innerHTML = "<option>Chưa có dữ liệu</option>";
  }
}

function renderOverview(examName, data) {
  const container = document.getElementById("historyOverview");
  const myHist = data.filter(
    (h) => h.examName === examName || h.examName.includes(examName)
  );
  if (myHist.length === 0) {
    container.style.display = "none";
    return;
  }
  const count = myHist.length;
  const maxScore = Math.max(...myHist.map((h) => h.score));
  const avgScore = Math.round(
    myHist.reduce((a, b) => a + b.percent, 0) / count
  );
  container.style.display = "flex";
  container.innerHTML = `
    <div class="overview-item"><span class="overview-val">${count}</span><span class="overview-label">Lần làm</span></div>
    <div style="width:1px; height:30px; background:#bfdbfe;"></div>
    <div class="overview-item"><span class="overview-val" style="color:${getMaxColor(
    maxScore
  )}">${maxScore} câu</span><span class="overview-label">Cao nhất</span></div>
    <div style="width:1px; height:30px; background:#bfdbfe;"></div>
    <div class="overview-item"><span class="overview-val">${avgScore}%</span><span class="overview-label">Trung bình</span></div>
  `;
}
function getMaxColor(p) {
  return p >= 90 ? "#16a34a" : p >= 50 ? "#d97706" : "#dc2626";
}

window.showHistory = async function () {
  const user = auth.currentUser;
  if (!user) {
    cloudAlert({ title: "Yêu cầu đăng nhập", message: "Vui lòng đăng nhập để xem lịch sử làm bài.", icon: "🔐" });
    return;
  }
  const modal = document.getElementById("historyModal");
  modal.style.display = "flex";

  document.getElementById("statsList").innerHTML =
    "<p style='text-align:center; padding:20px'>⏳ Đang tải...</p>";
  document.getElementById("aiResultBox").style.display = "none";

  document.getElementById("historyOverview").style.display = "none";
  document.getElementById("chartContainer").style.display = "none";

  window.switchHistoryTab("stats");

  let targetExamName = null;
  const isExamActive =
    document.getElementById("statusPanel").style.display !== "none";
  if (isExamActive) {
    targetExamName = document.getElementById("examName").textContent;
  } else if (pendingData) {
    targetExamName = pendingData.name;
  }

  if (globalHistoryData.length === 0) await fetchHistoryData(user.uid);

  if (targetExamName) {
    document.getElementById("filterArea").style.display = "none";
    document.getElementById("currentExamLabel").style.display = "none";
    document.getElementById("historyModalTitle").textContent = targetExamName;
    document.getElementById("historyOverview").style.display = "flex";

    renderOverview(targetExamName, globalHistoryData);
    renderChart(targetExamName, globalHistoryData);
    renderStats(targetExamName);
    renderTimeline(targetExamName);
  } else {
    document.getElementById("historyModalTitle").textContent =
      "Hồ sơ học tập chung";
    document.getElementById("filterArea").style.display = "flex";
    initStatsFilter();
    renderStats("all");
    renderTimeline("all");
  }
};

window.switchHistoryTab = function (tab) {
  document
    .querySelectorAll(".tab-btn")
    .forEach((b) => b.classList.remove("active"));
  document
    .querySelector(`.tab-btn[onclick="window.switchHistoryTab('${tab}')"]`)
    .classList.add("active");
  document.getElementById("tabStats").style.display =
    tab === "stats" ? "block" : "none";
  document.getElementById("tabTimeline").style.display =
    tab === "timeline" ? "block" : "none";
  document.getElementById("tabChart").style.display =
    tab === "chart" ? "block" : "none";
};

function initStatsFilter() {
  const sel = document.getElementById("statsFilter");
  const names = new Set();
  globalHistoryData.forEach((i) => names.add(i.examName));
  let html = `<option value="all">-- Tất cả --</option>`;
  names.forEach((n) => (html += `<option value="${n}">${n}</option>`));
  sel.innerHTML = html;
}
window.filterStats = function () {
  const val = document.getElementById("statsFilter").value;
  renderStats(val);
  renderTimeline(val);
};

async function renderStats(filterName) {
  const list = document.getElementById("statsList");
  const user = auth.currentUser;

  if (!user) {
    list.innerHTML =
      "<p style='text-align:center; padding:20px'>Vui lòng đăng nhập.</p>";
    return;
  }

  list.innerHTML =
    "<p style='text-align:center; padding:20px'>⏳ Đang đồng bộ dữ liệu từ Cloud...</p>";

  try {
    // 1. Lấy dữ liệu (Giữ nguyên logic lấy snapshot cũ)
    let snapshot;
    const collectionRef = db
      .collection("users")
      .doc(user.uid)
      .collection("mistake_tracking");

    if (filterName !== "all") {
      const safeId = getSafeId(filterName);
      const doc = await collectionRef.doc(safeId).get();
      snapshot = doc.exists ? { docs: [doc] } : { docs: [] };
    } else {
      snapshot = await collectionRef.get();
    }

    if (snapshot.empty) {
      list.innerHTML = `<div style="text-align:center; padding:40px;"><p style="color:var(--success); font-weight:bold;">Sổ tay câu sai trống!</p></div>`;
      return;
    }

    // 2. Xử lý dữ liệu (UPDATE MỚI: Đọc được cả dạng số và dạng object)
    let allMistakes = [];

    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      const examId = doc.id;

      Object.keys(data).forEach((key) => {
        if (key === "last_updated") return;

        let count = 0;
        let questionText = "";

        const entry = data[key];

        // --- LOGIC ĐỌC DỮ LIỆU THÔNG MINH ---
        if (typeof entry === "object" && entry !== null) {
          // Dạng mới (Câu dài): Lấy số lần từ .c và nội dung từ .t
          count = entry.c;
          questionText = entry.t;
        } else {
          // Dạng cũ (Câu ngắn): Giá trị chính là số lần
          count = entry;
          try {
            // Giải mã key để lấy lại nội dung câu hỏi
            questionText = decodeKey(key);
          } catch (e) {
            questionText = "Lỗi hiển thị câu hỏi";
          }
        }
        // -------------------------------------

        if (count > 0) {
          // Tìm đáp án đúng từ lịch sử cục bộ (nếu có)
          let foundAnswer = "Chưa có dữ liệu";
          for (let h of globalHistoryData) {
            if (h.details) {
              const qDetail = h.details.find(
                (d) => d.q.trim() === questionText.trim()
              );
              if (qDetail) {
                foundAnswer = qDetail.a;
                break;
              }
            }
          }

          allMistakes.push({
            q: questionText,
            a: foundAnswer,
            w: count,
            exam: examId,
          });
        }
      });
    });

    // 3. Sắp xếp & Render (Giữ nguyên phần render cũ của bạn)
    allMistakes.sort((a, b) => b.w - a.w);

    if (allMistakes.length === 0) {
      list.innerHTML = `<div style="text-align:center; padding:40px;"><p style="color:var(--success);">Bạn đã xóa hết nợ!</p></div>`;
      return;
    }

    let html = `<div style="padding:12px; background:#fff7ed; border:1px solid #fed7aa; color:#c2410c; margin-bottom:15px; border-radius:8px; font-size:14px;"><b>SỔ TAY CÂU SAI</b>: Còn <b>${allMistakes.length}</b> câu.</div>`;

    allMistakes.forEach((i) => {
      html += `
        <div class="weak-item">
            <div class="weak-count" style="background:#fee2e2; color:#ef4444; border-color:#fca5a5;">${i.w}</div>
            <div class="weak-content">
                <div class="weak-q">${i.q}</div>
                <div class="weak-ans" style="margin-top:5px; opacity:0.8">👉 Đáp án: <b>${i.a}</b></div>
            </div>
        </div>`;
    });

    list.innerHTML = html;
  } catch (e) {
    console.error(e);
    list.innerHTML = `<p style='color:red;'>Lỗi: ${e.message}</p>`;
  }
}

// Cập nhật hàm gọi khi đổi tab (để chuyển thành async)
window.filterStats = function () {
  const val = document.getElementById("statsFilter").value;
  renderStats(val);
  // Timeline vẫn giữ nguyên logic cũ (lấy từ history)
  renderTimeline(val);
};

function renderTimeline(filterName) {
  const list = document.getElementById("timelineList");
  let data = globalHistoryData;
  if (filterName !== "all") {
    data = data.filter(
      (i) => i.examName === filterName || i.examName.includes(filterName)
    );
  }
  if (!data.length) {
    list.innerHTML =
      "<p style='text-align:center; padding:20px; color:#64748b;'>Chưa có lịch sử làm bài nào.</p>";
    return;
  }
  let html = "";
  data.forEach((d) => {
    let scoreColor = "#16a34a";
    if (d.percent < 50) scoreColor = "#dc2626";
    else if (d.percent < 80) scoreColor = "#d97706";
    let detailsHtml = "";
    if (d.details && Array.isArray(d.details)) {
      detailsHtml = d.details
        .map((q, idx) => {
          const isRight = q.s;
          return `<div class="hist-q-item ${isRight ? "hist-correct" : "hist-wrong"
            }"><div class="hist-q-text"><span style="font-weight:bold; color:${isRight ? "#16a34a" : "#dc2626"
            }">Câu ${idx + 1}:</span> ${q.q}</div><div class="hist-user-ans">${isRight ? "✅" : "❌"
            } Bạn chọn: <b>${q.u || "(Bỏ trống)"}</b></div>${!isRight
              ? `<div class="hist-correct-ans">👉 Đáp án đúng: <b>${q.a}</b></div>`
              : ""
            }</div>`;
        })
        .join("");
    }
    html += `<div class="history-card-wrapper" id="card-${d.id
      }"><div class="history-summary" onclick="window.toggleHistoryDetail('${d.id
      }')"><div class="hist-left"><div class="hist-name">${d.examName
      }</div><div class="hist-date">${d.dateStr
      }</div></div><div class="hist-right"><div style="text-align:right; margin-right:8px;"><div class="hist-score" style="color:${scoreColor}">${d.score
      }/${d.total
      }</div><div class="hist-percent" style="background:${scoreColor}">${d.percent
      }%</div></div><div class="hist-arrow">▼</div></div></div><div id="detail-${d.id
      }" class="history-details-box" style="display:none;">${detailsHtml ||
      '<p style="padding:10px; text-align:center;">Không có dữ liệu chi tiết.</p>'
      }</div></div>`;
  });
  list.innerHTML = html;
}
window.toggleHistoryDetail = function (id) {
  const detailEl = document.getElementById(`detail-${id}`);
  const cardEl = document.getElementById(`card-${id}`);
  const arrowEl = cardEl.querySelector(".hist-arrow");
  if (detailEl.style.display === "none") {
    detailEl.style.display = "block";
    cardEl.classList.add("active");
    if (arrowEl) arrowEl.style.transform = "rotate(180deg)";
  } else {
    detailEl.style.display = "none";
    cardEl.classList.remove("active");
    if (arrowEl) arrowEl.style.transform = "rotate(0deg)";
  }
};

async function checkCurrentExamHistorySummary(examName) {
  const user = auth.currentUser;
  const summaryEl = document.getElementById("examHistorySummary");
  if (!summaryEl || !user || !examName) return;
  if (document.body.classList.contains("exam-taking")) {
    summaryEl.style.display = "none";
    return;
  }
  summaryEl.style.display = "none";
  await fetchHistoryData(user.uid);
  const myHist = globalHistoryData.filter(
    (h) => h.examName === examName || h.examName.includes(examName)
  );
  if (myHist.length > 0) {
    const maxScore = Math.max(...myHist.map((h) => h.percent));
    const count = myHist.length;
    summaryEl.style.display = "flex";
    summaryEl.innerHTML = `<div><span style="font-size:18px;">🎓</span> Bạn đã làm đề <b>"${examName}"</b> tổng cộng <b>${count}</b> lần. Thành tích tốt nhất: <b style="color:${getMaxColor(
      maxScore
    )}">${maxScore}%</b>.</div><u onclick="window.showHistory()" style="cursor:pointer; font-weight:600; margin-left:15px; white-space:nowrap;">Xem chi tiết</u>`;
  }
}

// ========================
// EVENTS (SỰ KIỆN KHỞI CHẠY)
// ========================
document.addEventListener("DOMContentLoaded", () => {
  document.body.classList.add("home-mode");
  const timeInputEl = document.getElementById("timeInput");
  if (timeInputEl) {
    const syncTimePreview = () => {
      const preview = document.getElementById("homeTimePreview");
      if (preview) preview.textContent = timeInputEl.value || 15;
    };
    timeInputEl.addEventListener("input", syncTimePreview);
    syncTimePreview();
  }

  // 1. Gán sự kiện cho các nút cơ bản
  document.getElementById("fileInput").onchange = window.loadFileFromLocal;
  document.getElementById("btnSelectDrive").onclick =
    window.chooseExamFromDriveFolder;
  document.getElementById("btnStart").onclick = window.startExamNow;
  document.getElementById("btnReset").onclick = window.resetExam;

  // 2. Sự kiện Sidebar Chế độ học (ĐÃ SỬA LỖI Ở ĐÂY)
  const studyOverlay = document.getElementById("studyOverlay");
  const btnOpenStudy = document.getElementById("btnOpenStudy");
  const btnCloseStudy = document.getElementById("btnCloseStudy");

  if (btnOpenStudy) {
    btnOpenStudy.onclick = () => {
      studyOverlay.classList.add("open");
    };
  }
  if (btnCloseStudy)
    btnCloseStudy.onclick = () => studyOverlay.classList.remove("open");
  if (studyOverlay) {
    studyOverlay.onclick = (e) => {
      if (e.target === studyOverlay) studyOverlay.classList.remove("open");
    };
  }

  // 3. Sự kiện Modal Drive
  const closeDriveBtn = document.getElementById("btnCloseDrive");
  if (closeDriveBtn) {
    closeDriveBtn.onclick = () => {
      document.getElementById("driveModal").style.display = "none";
    };
  }
  const driveModal = document.getElementById("driveModal");
  if (driveModal) {
    driveModal.onclick = (e) => {
      if (e.target === driveModal) driveModal.style.display = "none";
    };
  }

  // Sự kiện Cloud Upload (Nút chọn)
  const cloudFileInput = document.getElementById("cloudFileInput");
  if (cloudFileInput) {
    cloudFileInput.onchange = (e) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      window.focus();
      handleCloudFileDropOrSelect(files);
      cloudFileInput.value = "";
    };
  }

  // Sự kiện Kéo Thả (Drag & Drop)
  const cloudBody = document.querySelector(".cloud-body");
  if (cloudBody) {
    cloudBody.addEventListener("dragover", (e) => {
      e.preventDefault();
      cloudBody.classList.add("drag-over");
    });
    cloudBody.addEventListener("dragleave", (e) => {
      e.preventDefault();
      cloudBody.classList.remove("drag-over");
    });
    cloudBody.addEventListener("drop", (e) => {
      e.preventDefault();
      cloudBody.classList.remove("drag-over");
      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        handleCloudFileDropOrSelect(files);
      }
    });
  }

  async function handleCloudFileDropOrSelect(files) {
    if (!files) return;
    const fileArray = (files instanceof FileList) ? Array.from(files) : (Array.isArray(files) ? files : [files]);
    const validFiles = fileArray.filter(f => f.name.endsWith(".json"));
    
    if (validFiles.length === 0) {
       cloudAlert({ title: 'Lỗi File', message: 'Vui lòng chọn file JSON hợp lệ!', icon: '⚠️' });
       return;
    }

    if (validFiles.length === 1) {
      const file = validFiles[0];
      const defaultName = file.name.replace(/\.json$/i, "");
      const displayName = await cloudAlert({
        type: 'prompt',
        title: 'Tên đề thi',
        message: 'Nhập tên hiển thị cho đề thi này:',
        icon: '📝',
        defaultValue: defaultName
      });

      if (displayName !== null) {
        uploadJsonToCloud(file, displayName.trim() || defaultName);
      }
    } else {
      const confirmUpload = await cloudAlert({
        type: 'confirm',
        title: 'Tải lên nhiều đề',
        message: `Bạn đang tải lên ${validFiles.length} đề thi. Tên hiển thị sẽ tự động lấy từ tên file. Tiếp tục?`,
        icon: '📚'
      });
      if (confirmUpload) {
        window.setCloudLoading(true, "Đang tải lên...");
        let successCount = 0;
        let failCount = 0;
        for (const file of validFiles) {
          try {
             const text = await file.text();
             JSON.parse(text);
             if (text.length > 900000) throw new Error("File quá lớn");
             await db.collection("users").doc(auth.currentUser.uid).collection("examFiles").add({
               displayName: file.name.replace(/\.json$/i, ""),
               fileName: file.name,
               content: text,
               folderId: currentFolderId,
               createdAt: firebase.firestore.FieldValue.serverTimestamp(),
             });
             successCount++;
          } catch(e) {
             failCount++;
          }
        }
        window.setCloudLoading(false);
        cloudAlert({ title: 'Hoàn tất', message: `Tải lên thành công: ${successCount} đề. Lỗi: ${failCount} đề.`, icon: '✅' });
        loadCloudDirectory();
      }
    }
  }

  // 4. Sự kiện Nộp bài
  const handleSubmission = async () => {
    if (examFinished) return;
    if (!questionsData || questionsData.length === 0) return;
    const answeredCount = document.querySelectorAll(
      'input[type="radio"]:checked'
    ).length;
    const total = questionsData.length;
    const unanswer = total - answeredCount;
    let msg = "Bạn có chắc chắn muốn nộp bài không?";
    if (unanswer > 0) {
      msg = `Bạn còn ${unanswer} câu chưa chọn đáp án.\nBạn có chắc chắn muốn nộp bài không?`;
    }

    const confirmSub = await cloudAlert({
      type: 'confirm',
      title: 'Nộp bài',
      message: msg,
      icon: '📝'
    });

    if (confirmSub) {
      grade(false);
      // Thu gọn header trên mobile sau khi nộp
      if (window.innerWidth <= 850) {
        const header = document.getElementById("mainHeader");
        const toggleBtn = document.getElementById("btnToggleHeaderMobile");
        header.classList.add("header-hidden");
        toggleBtn.textContent = "▼";
      }
    }
  };
  document.getElementById("btnGradeHeader").onclick = handleSubmission;
  document.getElementById("btnGradeNav").onclick = handleSubmission;
  const btnActiveGrade = document.getElementById("btnActiveGrade");
  if (btnActiveGrade) btnActiveGrade.onclick = handleSubmission;
  const btnActiveReset = document.getElementById("btnActiveReset");
  if (btnActiveReset) btnActiveReset.onclick = window.resetExam;
  const btnActiveToggleNav = document.getElementById("btnActiveToggleNav");
  if (btnActiveToggleNav) btnActiveToggleNav.onclick = window.openQuestionNav;

  // 5. Các sự kiện UI khác
  document.getElementById("btnViewHistory").onclick = window.showHistory;
  document.getElementById("btnCloseHistory").onclick = () =>
    (document.getElementById("historyModal").style.display = "none");
  document.getElementById("btnToggleNavMobile").onclick =
    window.openQuestionNav;
  document.getElementById("questionNavCloseBtn").onclick =
    window.closeQuestionNav;
  document.getElementById("questionNavOverlay").onclick = (e) => {
    if (e.target.id === "questionNavOverlay") window.closeQuestionNav();
  };
  document.getElementById("btnToggleNavMobileInHeader").onclick =
    window.openQuestionNav;

  // 6. Toggle Header Mobile
  const header = document.getElementById("mainHeader");
  const toggleBtn = document.getElementById("btnToggleHeaderMobile");
  if (toggleBtn) {
    toggleBtn.onclick = () => {
      header.classList.toggle("header-hidden");
      if (header.classList.contains("header-hidden")) {
        toggleBtn.textContent = "▼";
        toggleBtn.title = "Hiện thanh công cụ";
      } else {
        toggleBtn.textContent = "▲";
        toggleBtn.title = "Ẩn thanh công cụ";
      }
    };
  }

  const activeHeader = document.getElementById("examActiveHeader");
  const toggleActiveBtn = document.getElementById("btnToggleActiveHeaderMobile");
  if (toggleActiveBtn) {
    toggleActiveBtn.onclick = () => {
      activeHeader.classList.toggle("header-hidden");
      if (activeHeader.classList.contains("header-hidden")) {
        toggleActiveBtn.textContent = "▼";
        toggleActiveBtn.title = "Hiện menu bài thi";
      } else {
        toggleActiveBtn.textContent = "▲";
        toggleActiveBtn.title = "Ẩn menu bài thi";
      }
    };
  }

  // 7. Toggle AI Expanded
  const aiBox = document.getElementById("aiResultBox");
  const expandBtn = document.getElementById("btnExpandAI");
  const closeExpandedBtn = document.getElementById("btnCloseExpanded");
  const aiSectionParent = document.getElementById("aiSection");

  if (closeExpandedBtn) closeExpandedBtn.textContent = "✕";

  const toggleExpand = () => {
    const isExpanded = aiBox.classList.contains("expanded");
    if (!isExpanded) {
      document.body.appendChild(aiBox);
      requestAnimationFrame(() => {
        aiBox.classList.add("expanded");
        document.body.classList.add("ai-open");
      });
      if (expandBtn) expandBtn.style.display = "none";
    } else {
      if (aiAbortController) aiAbortController.abort(); // Hủy yêu cầu AI khi đóng modal
      aiBox.classList.remove("expanded");
      aiBox.classList.remove("is-loading");
      document.body.classList.remove("ai-open");
      aiSectionParent.appendChild(aiBox);
      if (expandBtn) expandBtn.style.display = "inline-flex";
    }
  };

  if (expandBtn) {
    expandBtn.onclick = (e) => {
      e.stopPropagation();
      toggleExpand();
    };
  }
  if (closeExpandedBtn) {
    closeExpandedBtn.onclick = (e) => {
      e.stopPropagation();
      toggleExpand();
    };
  }
  if (aiBox) {
    aiBox.onclick = (e) => {
      if (e.target.closest('button')) return; // Bỏ qua nếu click vào các nút bên trong
      
      if (aiBox.classList.contains("expanded")) {
        // Chỉ đóng nếu click trúng phần nền tối (chứ không phải nội dung bên trong)
        if (e.target === aiBox) toggleExpand();
      } else {
        // Nếu chưa phóng to, click vào đâu trong box cũng phóng to
        toggleExpand();
      }
    };
  }

  // 8. Các nút chức năng AI
  document.getElementById("btnAISettings").onclick = window.promptForKeys;
  document.getElementById("btnAnalyzeAI").onclick = () =>
    analyzeWithGemini(false);
  const btnRe = document.getElementById("btnReAnalyzeAI");
  if (btnRe) {
    btnRe.onclick = async () => {
      const confirmRe = await cloudAlert({
        type: 'confirm',
        title: 'Chạy lại AI',
        message: 'Bạn có chắc muốn chạy lại AI không?\n(Sẽ tốn thêm 1 lượt dùng trong ngày)',
        icon: '🔄'
      });
      if (confirmRe) {
        analyzeWithGemini(true);
      }
    };
  }

  // 9. Nút cài đặt Key
  const btnSetupKey = document.createElement("button");
  btnSetupKey.className = "btn-icon-small";
  btnSetupKey.textContent = "🔑";
  btnSetupKey.onclick = promptForKeys;
  const aiHeaderTitle = document.querySelector(".ai-header h4");
  if (aiHeaderTitle) aiHeaderTitle.appendChild(btnSetupKey);

  // 10. Dark Mode Logic
  const btnDark = document.getElementById("btnToggleDark");
  if (btnDark) {
    if (localStorage.getItem("darkMode") === "true") {
      document.body.classList.add("dark-mode");
      btnDark.textContent = "☀️";
    }
    btnDark.onclick = () => {
      document.body.classList.toggle("dark-mode");
      const isDark = document.body.classList.contains("dark-mode");
      btnDark.textContent = isDark ? "☀️" : "🌙";
      localStorage.setItem("darkMode", isDark);
    };
  }

  updateFileStatus("", false);
}); // --- KẾT THÚC DOMContentLoaded ---

// ==========================================
// CÁC HÀM LOGIC TOÀN CỤC (WINDOW FUNCTIONS)
// Để ở ngoài cùng để HTML gọi được
// ==========================================

// ==========================================
// LOGIC FLASHCARD (CHẾ ĐỘ 1 CÂU - SINGLE VIEW)
// ==========================================

let currentFcIndex = 0; // Biến theo dõi câu hiện tại

// 1. Chế độ: FLASHCARD
window.startFlashcardMode = async function () {
  // --- FIX: Tự động nạp dữ liệu từ file vừa chọn nếu chưa bấm Start ---
  if ((!questionsData || questionsData.length === 0) && pendingData) {
    // Clone dữ liệu từ pendingData sang questionsData
    questionsData = pendingData.data.map((q) => ({
      ...q,
      options: Array.isArray(q.options) ? [...q.options] : [],
    }));
    // Xáo trộn đề ngay lập tức để học ngẫu nhiên
    shuffleArray(questionsData);
    questionsData.forEach((q) => {
      if (Array.isArray(q.options)) shuffleArray(q.options);
    });
    // Cập nhật tên đề
    document.getElementById("examName").textContent = pendingData.name;
  }
  // -----------------------------------------------------------------------

  // Kiểm tra lại lần nữa
  if (!questionsData || questionsData.length === 0) {
    cloudAlert({ title: "Thông báo", message: "Bạn chưa chọn đề thi nào! Vui lòng Tải file hoặc chọn từ Drive trước.", icon: "ℹ️" });
    return;
  }

  document.getElementById("studyOverlay").classList.remove("open");

  const confirmFc = await cloudAlert({
    type: 'confirm',
    title: 'Flashcard',
    message: 'Bắt đầu chế độ Flashcard?\n(Giao diện tập trung, mỗi lần 1 câu)',
    icon: '⚡'
  });
  if (!confirmFc) return;

  // Setup dữ liệu
  isReviewMode = true;
  examFinished = false;
  currentFcIndex = 0;

  // Xáo trộn lại lần nữa
  shuffleArray(questionsData);

  // UI Updates
  document.getElementById("quiz").style.display = "none"; // Ẩn danh sách cũ
  document.getElementById("flashcardContainer").style.display = "flex"; // Hiện Flashcard

  // Nếu tên đề chưa có (do chưa bấm Start), lấy từ pendingData hoặc đặt mặc định
  if (
    document.getElementById("examName").textContent === "Đang tải..." &&
    pendingData
  ) {
    document.getElementById("examName").textContent = pendingData.name;
  } else if (
    document.getElementById("examName").textContent === "Đang tải..."
  ) {
    document.getElementById("examName").textContent = "⚡ FLASHCARD MODE";
  }

  setHeaderMode("active");
  document.getElementById("timer").textContent = "∞"; // Không tính giờ
  document.getElementById("btnGradeHeader").style.display = "none";
  document.getElementById("btnGradeNav").style.display = "none";

  // Render câu đầu tiên
  renderFlashcard();
};

// 2. Render câu hỏi hiện tại
window.renderFlashcard = function () {
  const container = document.getElementById("fcCard");
  const q = questionsData[currentFcIndex];
  const total = questionsData.length;

  // Cập nhật số trang
  document.getElementById("fcCurrent").textContent = currentFcIndex + 1;
  document.getElementById("fcTotal").textContent = total;

  // Disable nút Prev nếu là câu 1, Next nếu là câu cuối
  document.getElementById("btnFcPrev").disabled = currentFcIndex === 0;
  document.getElementById("btnFcNext").textContent =
    currentFcIndex === total - 1 ? "Hoàn thành 🏁" : "Câu tiếp ➡";

  // HTML Nội dung thẻ
  let html = `<div class="fc-question-text">${q.question}</div>
              <div class="fc-options">`;

  const letters = ["A", "B", "C", "D", "E", "F"];
  (q.options || []).forEach((opt, i) => {
    // Lưu ý: Dùng onclick để gọi hàm xử lý chọn
    html += `
      <div class="fc-option-item" onclick="handleFlashcardSelect(this, '${i}')">
          <span style="font-weight:bold; color:var(--primary); min-width:25px">${letters[i]}.</span>
          <span>${opt}</span>
      </div>`;
  });
  html += `</div>`;

  // Thêm vùng giải thích (ẩn mặc định)
  html += `<div id="fcExplain" class="review-explain" style="display:none; margin-top:20px;">
              <b>💡 Giải thích:</b> ${q.explain || "Không có giải thích chi tiết."
    }
           </div>`;

  container.innerHTML = html;

  // Hiệu ứng Fade In nhẹ
  container.style.opacity = 0;
  setTimeout(() => (container.style.opacity = 1), 50);
};

// 3. Xử lý khi chọn đáp án
window.handleFlashcardSelect = function (el, optIndex) {
  // Chặn click nếu đã chọn rồi (để tránh spam)
  if (
    document.querySelector(".fc-option-item.correct") ||
    document.querySelector(".fc-option-item.incorrect")
  ) {
    return;
  }

  const q = questionsData[currentFcIndex];
  const userVal = (q.options[optIndex] || "").trim();
  const correctVal = (q.answer || "").trim();
  const currentExamName = pendingData ? pendingData.name : "Flashcard Session"; // Lấy tên đề gốc

  const allOpts = document.querySelectorAll(".fc-option-item");

  // Xử lý đúng sai
  if (userVal === correctVal) {
    // ĐÚNG
    el.classList.add("correct");

    // Gọi Firebase trừ điểm
    updateMistakeInCloud(currentExamName, q.question, true).then(
      (remaining) => {
        showFcFeedback(true, remaining);
      }
    );
  } else {
    // SAI
    el.classList.add("incorrect");

    // Tìm và hiện đáp án đúng
    allOpts.forEach((optEl) => {
      const text = optEl.querySelector("span:last-child").textContent;
      if (text.trim() === correctVal) {
        optEl.classList.add("correct");
      }
    });

    // Gọi Firebase cộng điểm
    updateMistakeInCloud(currentExamName, q.question, false).then(() => {
      showFcFeedback(false);
    });
  }

  // Hiện giải thích
  document.getElementById("fcExplain").style.display = "block";
};

// 4. Hiển thị thông báo phản hồi dưới thẻ
function showFcFeedback(isCorrect, remaining = 0) {
  let div = document.createElement("div");
  div.className = "fc-feedback";

  if (isCorrect) {
    if (remaining > 0) {
      div.style.background = "#fff7ed";
      div.style.color = "#c2410c";
      div.innerHTML = `👏 Đúng rồi! Còn nợ <b>${remaining}</b> lần nữa.`;
    } else {
      div.style.background = "#f0fdf4";
      div.style.color = "#16a34a";
      div.innerHTML = `🎉 Xuất sắc! Đã xóa khỏi danh sách câu sai.`;
    }
  } else {
    div.style.background = "#fef2f2";
    div.style.color = "#dc2626";
    div.innerHTML = `⚠️ Sai rồi! Đã ghi nhớ lỗi này vào hệ thống.`;
  }

  document.getElementById("fcCard").appendChild(div);
}

// 5. Điều hướng
window.nextFlashcard = async function () {
  if (currentFcIndex < questionsData.length - 1) {
    currentFcIndex++;
    renderFlashcard();
  } else {
    const confirmExit = await cloudAlert({
      type: 'confirm',
      title: 'Hoàn thành',
      message: 'Bạn đã hoàn thành bộ Flashcard! Quay lại màn hình chính?',
      icon: '🏁'
    });
    if (confirmExit) {
      window.exitFlashcardMode();
    }
  }
};

window.prevFlashcard = function () {
  if (currentFcIndex > 0) {
    currentFcIndex--;
    renderFlashcard();
  }
};

// 6. Thoát chế độ Flashcard
window.exitFlashcardMode = function () {
  document.getElementById("flashcardContainer").style.display = "none";
  document.getElementById("quiz").style.display = "block";
  document.getElementById("examName").textContent = pendingData
    ? pendingData.name
    : "Đề thi";
  setHeaderMode("setup");

  // Reset lại đề thi về trạng thái ban đầu (để làm bài thi thật nếu muốn)
  window.resetExam();
};

// 2. Chế độ: LUYỆN TẬP TRUNG (Câu sai từ lịch sử)
window.startWeaknessReview = async function () {
  if (!globalHistoryData || globalHistoryData.length === 0) {
    cloudAlert({ title: "Thông báo", message: "Bạn chưa có lịch sử làm bài. Hãy làm thử vài đề trước!", icon: "ℹ️" });
    return;
  }
  document.getElementById("studyOverlay").classList.remove("open");

  let wrongQuestionsMap = {};
  globalHistoryData.forEach((exam) => {
    if (exam.details) {
      exam.details.forEach((d) => {
        if (!d.s) {
          wrongQuestionsMap[d.q.trim()] = {
            question: d.q,
            answer: d.a,
            explain: "Ôn tập lại câu sai từ quá khứ",
          };
        }
      });
    }
  });

  const weakList = Object.values(wrongQuestionsMap);
  if (weakList.length === 0) {
    cloudAlert({ title: "Tuyệt vời", message: "Tuyệt vời! Bạn không có câu sai nào trong lịch sử.", icon: "🎉" });
    return;
  }

  const confirmWeak = await cloudAlert({
    type: 'confirm',
    title: 'Ôn tập câu sai',
    message: `Tìm thấy ${weakList.length} câu bạn từng làm sai.\nBạn có muốn ôn tập lại không?`,
    icon: '🧠'
  });
  if (!confirmWeak) return;

  questionsData = weakList.map((item) => {
    return {
      question: item.question,
      options: [
        item.answer,
        "Đáp án sai 1",
        "Đáp án sai 2",
        "Đáp án sai 3",
      ].sort(() => Math.random() - 0.5),
      answer: item.answer,
      explain: item.explain,
    };
  });

  isReviewMode = true;
  examFinished = false;
  document.getElementById("examName").textContent =
    "🧠 Ôn tập câu sai (Tổng hợp)";
  setHeaderMode("active");
  document.getElementById("timer").textContent = "ÔN TẬP";
  document.getElementById("btnGradeHeader").style.display = "none";
  document.getElementById("result").innerHTML =
    "<b style='color:#22c55e'>🧠 LUYỆN TẬP TRUNG</b>";
  generateQuiz();
  window.scrollTo({ top: 0, behavior: "smooth" });
};

// 3. Chế độ: Ôn câu sai (Spaced Repetition - Cloud Version)
window.startReviewMistakes = async function () {
  const user = auth.currentUser;
  if (!user) {
    cloudAlert({ title: "Đăng nhập", message: "Bạn cần Đăng nhập để dùng tính năng đồng bộ này!", icon: "⚠️" });
    return;
  }

  // 1. Xác định đề thi
  let examName = "";
  if (pendingData) examName = pendingData.name;
  else if (document.getElementById("examName").textContent !== "Đang tải...") {
    examName = document.getElementById("examName").textContent;
  }

  if (!examName) {
    cloudAlert({ title: "Thông báo", message: "Vui lòng chọn một đề thi trước để hệ thống biết bạn muốn ôn đề nào.", icon: "ℹ️" });
    return;
  }

  // UI Loading
  const btnStart = document.querySelector(
    "#studyOverlay .study-card:first-child"
  );
  const oldText = btnStart.innerHTML;
  btnStart.innerHTML = "⏳ Đang tải từ Cloud...";

  // 2. Tải danh sách lỗi từ Firebase
  const mistakeData = await fetchMistakesFromCloud(examName);
  const mistakeKeys = Object.keys(mistakeData).filter(
    (k) => k !== "last_updated"
  );

  // Reset UI
  btnStart.innerHTML = oldText;
  document.getElementById("studyOverlay").classList.remove("open");

  if (mistakeKeys.length === 0) {
    cloudAlert({ title: "Thông báo", message: `Tuyệt vời! Bạn không có câu sai nào được lưu cho đề "${examName}".`, icon: "🎉" });
    return;
  }

  const confirmReview = await cloudAlert({
    type: 'confirm',
    title: 'Ôn câu sai (Cloud)',
    message: `Cloud: Tìm thấy ${mistakeKeys.length} câu bạn chưa thuộc trong đề "${examName}".\nBạn có muốn ôn lại ngay không?`,
    icon: '☁️'
  });
  if (!confirmReview) return;

  // 3. Lấy nội dung câu hỏi từ dữ liệu gốc
  if (!pendingData || !pendingData.data) {
    cloudAlert({ title: "Lỗi", message: "Vui lòng nạp lại file đề gốc để hệ thống lấy nội dung câu hỏi.", icon: "❌" });
    return;
  }

  // Lọc câu hỏi: So sánh mã hóa Base64
  const reviewQuestions = pendingData.data.filter((q) => {
    const key = encodeKey(q.question);
    return mistakeData[key] > 0;
  });

  if (reviewQuestions.length === 0) {
    cloudAlert({ title: "Lỗi đồng bộ", message: "Dữ liệu trên Cloud không khớp với file đề hiện tại.\n(Có thể nội dung câu hỏi trong file đã bị sửa?)", icon: "⚠️" });
    return;
  }

  // 4. Bắt đầu ôn tập
  questionsData = reviewQuestions.map((q) => ({
    ...q,
    options: shuffleArray([...q.options]),
  }));

  isReviewMode = true;
  examFinished = false;
  document.getElementById("examName").textContent = examName;
  setHeaderMode("active");

  document.getElementById("timer").textContent = "CLOUD";
  document.getElementById(
    "result"
  ).innerHTML = `<b style='color:#ea580c'>🔥 CÒN ${questionsData.length} CÂU CẦN KHẮC PHỤC</b>`;
  document.getElementById("btnGradeHeader").style.display = "none";
  document.getElementById("btnGradeNav").style.display = "none";

  generateQuiz();
  window.scrollTo({ top: 0, behavior: "smooth" });
};

// ==========================================
// HỆ THỐNG GAMIFICATION (LEVEL & STREAK 2.0)
// ==========================================

let userStats = {
  xp: 0, // XP tích lũy hiện tại (trong cấp này)
  level: 1, // Cấp độ hiện tại
  streak: 0, // Chuỗi ngày
  lastStudyDate: null, // Ngày học cuối "YYYY-MM-DD"
};

// 1. TÍNH ĐỘ KHÓ: Càng lên cao càng cần nhiều XP
// Công thức: XP cần = Level hiện tại * 500
// VD: Lv1->Lv2 cần 500XP. Lv2->Lv3 cần 1000XP.
function getRequiredXP(level) {
  return level * 500;
}

// 2. Khởi tạo & Tải dữ liệu từ Cloud
async function initGamification() {
  const user = auth.currentUser;
  if (!user) return;

  const docRef = db.collection("users").doc(user.uid);
  try {
    const doc = await docRef.get();
    if (doc.exists) {
      const data = doc.data();
      if (data.gamification) {
        userStats = { ...userStats, ...data.gamification };
      }
    }
    checkStreakLogic(); // Kiểm tra xem có bị mất chuỗi không
    updateGamificationUI();
  } catch (e) {
    console.error("Lỗi tải Gamification:", e);
  }
}

// 3. Logic Streak (Giữ lửa)
function checkStreakLogic() {
  const today = new Date().toISOString().split("T")[0];

  if (userStats.lastStudyDate !== today) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split("T")[0];

    // Nếu ngày học cuối KHÔNG PHẢI là hôm qua (tức là đã bỏ > 1 ngày) -> Reset về 0
    if (userStats.lastStudyDate && userStats.lastStudyDate < yesterdayStr) {
      userStats.streak = 0;
    }
  }
}

// 4. HÀM CỘNG ĐIỂM (Gọi khi nộp bài)
async function gainXP(amount) {
  const user = auth.currentUser;
  if (!user) return;

  userStats.xp += amount;

  // Logic thăng cấp (Level Up Loop)
  // Dùng vòng lặp để xử lý trường hợp cộng nhiều XP thăng vài cấp 1 lúc
  let leveledUp = false;
  while (true) {
    const required = getRequiredXP(userStats.level);
    if (userStats.xp >= required) {
      userStats.xp -= required; // Trừ đi XP đã dùng để thăng cấp
      userStats.level++;
      leveledUp = true;
    } else {
      break;
    }
  }

  if (leveledUp) {
    cloudAlert({
      title: "🎉 THĂNG CẤP!",
      message: `Chúc mừng! Bạn đã thăng lên Cấp ${userStats.level}!\nĐộ khó cấp tiếp theo: ${getRequiredXP(userStats.level)} XP`,
      icon: "🏆"
    });
  }

  // Cập nhật Streak (Nếu hôm nay chưa tính)
  const today = new Date().toISOString().split("T")[0];
  if (userStats.lastStudyDate !== today) {
    userStats.streak++;
    userStats.lastStudyDate = today;

    // Hiệu ứng phóng to Lửa
    const fireBadge = document.querySelector(".streak-badge");
    if (fireBadge) {
      fireBadge.style.transform = "scale(1.3)";
      setTimeout(() => (fireBadge.style.transform = "scale(1)"), 400);
    }
  }

  updateGamificationUI();

  // Lưu Cloud
  try {
    await db.collection("users").doc(user.uid).set(
      {
        gamification: userStats,
      },
      { merge: true }
    );
  } catch (e) {
    console.error(e);
  }
}

// 5. Cập nhật giao diện (PHIÊN BẢN: SLIM & INTENSE)
// 5. Cập nhật giao diện (PHIÊN BẢN: ULTIMATE ANIMATION)
function updateGamificationUI() {
  const panel = document.getElementById("gamificationPanel");
  const lvEl = document.getElementById("userLevel");
  const strEl = document.getElementById("streakCount");

  if (!lvEl || !strEl) return;

  lvEl.textContent = userStats.level;
  strEl.textContent = userStats.streak;

  const required = getRequiredXP(userStats.level);
  const percent = Math.min((userStats.xp / required) * 100, 100);

  document.getElementById("currentXP").textContent = `${userStats.xp} XP`;
  document.getElementById("requiredXP").textContent = `/ ${required} XP`;
  document.getElementById("xpBar").style.width = `${percent}%`;

  // --- LOGIC PHÂN CẤP (TIER SYSTEM) ---
  // Tự động đổi giao diện dựa trên Level
  let rankClass = "rank-1";
  let rankName = "Tân Binh";

  // MỐC LEVEL:
  // 1-9: Rank 1
  // 10-29: Rank 2 (Elite)
  // 30-49: Rank 3 (Master - Lửa)
  // 50+: Rank 4 (Legendary - RGB)

  if (userStats.level >= 50) {
    rankClass = "rank-4";
    rankName = "⚔️ HUYỀN THOẠI ⚔️";
  } else if (userStats.level >= 30) {
    rankClass = "rank-3";
    rankName = "🔥 ĐẠI SƯ 🔥";
  } else if (userStats.level >= 10) {
    rankClass = "rank-2";
    rankName = "✨ TINH ANH";
  }

  // Reset class cũ và gán class mới
  panel.className = "user-stats-card";
  panel.classList.add(rankClass);

  // Hiệu ứng Streak cao: Nếu chuỗi > 3 ngày, thêm class cháy mạnh
  if (userStats.streak >= 3) {
    document.querySelector(".fire-icon").style.animationDuration = "0.8s"; // Tim đập nhanh hơn
  } else {
    document.querySelector(".fire-icon").style.animationDuration = "1.5s";
  }

  // Cập nhật tên danh hiệu
  const titleEl = document.getElementById("levelTitle");
  titleEl.textContent = rankName;
}

// Khởi chạy khi login
auth.onAuthStateChanged((user) => {
  if (user) initGamification();
});



// ================================================================
// EXAM REVIEW PAGE v5.0 — Viết lại hoàn toàn
// ================================================================

window.openExamReview = async function(historyId) {
  const user = auth.currentUser;
  if (!user) return;

  // Ẩn modal lịch sử
  const modal = document.getElementById('historyModal');
  if (modal) modal.style.display = 'none';

  // Hiện trang xem lại
  const page = document.getElementById('examReviewPage');
  page.style.display = 'flex';

  // Reset header về trạng thái loading
  document.getElementById('reviewPageExamName').textContent = 'Đang tải...';
  document.getElementById('reviewPageDate').textContent = '';
  const badge = document.getElementById('reviewPageScoreBadge');
  badge.className = 'erp-score-pill';
  badge.innerHTML = '';

  // Hiện loading spinner
  document.getElementById('examReviewContent').innerHTML = `
    <div class="erp-loading">
      <div class="erp-spinner"></div>
      <span>Đang tải dữ liệu bài thi...</span>
    </div>`;

  // Lấy dữ liệu từ cache hoặc Firestore
  let attempt = (globalHistoryData || []).find(h => h.id === historyId);
  if (!attempt) {
    try {
      const snap = await db.collection('users').doc(user.uid)
        .collection('history').doc(historyId).get();
      if (snap.exists) attempt = { id: snap.id, ...snap.data() };
    } catch (e) {
      document.getElementById('examReviewContent').innerHTML = `
        <div class="erp-empty">
          <span class="erp-empty__icon">⚠️</span>
          <p class="erp-empty__title">Lỗi tải dữ liệu</p>
          <p class="erp-empty__desc">Kiểm tra kết nối mạng và thử lại.</p>
        </div>`;
      return;
    }
  }
  if (!attempt) {
    document.getElementById('examReviewContent').innerHTML = `
      <div class="erp-empty">
        <span class="erp-empty__icon">📭</span>
        <p class="erp-empty__title">Không tìm thấy bài thi</p>
        <p class="erp-empty__desc">Bài thi này có thể đã bị xóa.</p>
      </div>`;
    return;
  }

  // ── Cập nhật header ──
  document.getElementById('reviewPageExamName').textContent = attempt.examName || 'Bài thi';
  document.getElementById('reviewPageDate').textContent = '📅 ' + (attempt.dateStr || '');

  const p = attempt.percent || 0;
  const gradeClass = p >= 80 ? 'grade-great' : p >= 50 ? 'grade-ok' : 'grade-bad';
  const gradeLabel = p >= 90 ? 'Xuất sắc' : p >= 80 ? 'Giỏi' : p >= 60 ? 'Khá' : p >= 50 ? 'Trung bình' : 'Cần cố gắng';
  badge.className = 'erp-score-pill ' + gradeClass;
  badge.innerHTML = `
    <span class="erp-score-pill__num">${attempt.score}/${attempt.total}</span>
    <span class="erp-score-pill__meta">
      <span class="erp-score-pill__pct">${p}%</span>
      <span class="erp-score-pill__lbl">${gradeLabel}</span>
    </span>`;

  // ── Thống kê ──
  const details = attempt.details || [];
  const cntOk   = details.filter(q => q.s).length;
  const cntBad  = details.filter(q => !q.s && q.u).length;
  const cntSkip = details.filter(q => !q.u).length;

  // ── Store cho AI ──
  window.reviewQuestionStore = {};

  // ── Render từng câu hỏi ──
  let cardsHtml = '';

  if (!details.length) {
    cardsHtml = `
      <div class="erp-empty">
        <span class="erp-empty__icon">📋</span>
        <p class="erp-empty__title">Không có dữ liệu chi tiết</p>
        <p class="erp-empty__desc">Bài thi này chưa lưu dữ liệu từng câu.<br>Hãy làm lại để xem kết quả đầy đủ.</p>
      </div>`;
  } else {
    details.forEach((q, i) => {
      const key = i + '_' + historyId.substring(0, 8);
      window.reviewQuestionStore[key] = q;

      const ok    = !!q.s;
      const skip  = !q.u;
      const mod   = skip ? 'erp-card--skip' : ok ? 'erp-card--ok' : 'erp-card--bad';
      const label = skip ? 'Bỏ trống' : ok ? 'Đúng ✓' : 'Sai ✗';

      const opts = q.opts || [];
      const ans  = (q.a || '').trim();
      const sel  = (q.u || '').trim();

      // Render options
      let optsHtml = '';
      if (opts.length > 0) {
        optsHtml = '<div class="erp-options">';
        opts.forEach((opt, oi) => {
          const letter  = String.fromCharCode(65 + oi);
          const isAns   = opt.trim() === ans || letter === ans;
          const isSel   = opt.trim() === sel  || letter === sel;
          const isBad   = isSel && !isAns;

          let cls = '', keyContent = letter, labelHtml = '';
          if (isAns && isSel) {
            cls = 'erp-opt--ok';
            keyContent = '✓';
            labelHtml = `<span class="erp-opt__label">Đúng ✓</span>`;
          } else if (isAns) {
            cls = 'erp-opt--ok';
            keyContent = '✓';
            labelHtml = `<span class="erp-opt__label">Đáp án đúng</span>`;
          } else if (isBad) {
            cls = 'erp-opt--bad';
            keyContent = '✗';
            labelHtml = `<span class="erp-opt__label">Bạn chọn</span>`;
          }

          optsHtml += `
            <div class="erp-opt ${cls}">
              <span class="erp-opt__key">${keyContent}</span>
              <span class="erp-opt__text">${opt}</span>
              ${labelHtml}
            </div>`;
        });
        optsHtml += '</div>';

      } else if (sel || ans) {
        // Không có options array — hiển thị dạng text
        optsHtml = '<div class="erp-options">';
        if (sel) {
          const cls = ok ? 'erp-opt--ok' : 'erp-opt--bad';
          const icon = ok ? '✓' : '✗';
          optsHtml += `<div class="erp-opt ${cls}"><span class="erp-opt__key">${icon}</span><span class="erp-opt__text">Bạn chọn: <b>${sel}</b></span></div>`;
        }
        if (!ok && ans) {
          optsHtml += `<div class="erp-opt erp-opt--ok"><span class="erp-opt__key">✓</span><span class="erp-opt__text">Đáp án đúng: <b>${ans}</b></span></div>`;
        }
        optsHtml += '</div>';
      }

      const explainHtml = q.ex
        ? `<div class="erp-explain"><span class="erp-explain__bulb">💡</span><span class="erp-explain__text"><b>Giải thích:</b> ${q.ex}</span></div>`
        : '';

      cardsHtml += `
        <div class="erp-card ${mod}">
          <div class="erp-card__strip"></div>
          <div class="erp-card__body">
            <div class="erp-card__row">
              <div class="erp-card__idx">${i + 1}</div>
              <div class="erp-card__q">${q.q}</div>
              <span class="erp-card__tag">${label}</span>
            </div>
            ${optsHtml}
            ${explainHtml}
            <button class="erp-ai-btn" onclick="window.openAIFromReviewByKey('${key}')">🧠 Hỏi Gia sư AI</button>
          </div>
        </div>`;
    });
  }

  document.getElementById('examReviewContent').innerHTML = `
    <div class="erp-chips">
      <div class="erp-chip erp-chip--ok">
        <div class="erp-chip__dot">✓</div>
        <div class="erp-chip__body">
          <span class="erp-chip__num">${cntOk}</span>
          <span class="erp-chip__txt">Chính xác</span>
        </div>
      </div>
      <div class="erp-chip erp-chip--bad">
        <div class="erp-chip__dot">✗</div>
        <div class="erp-chip__body">
          <span class="erp-chip__num">${cntBad}</span>
          <span class="erp-chip__txt">Sai</span>
        </div>
      </div>
      <div class="erp-chip erp-chip--skip">
        <div class="erp-chip__dot">–</div>
        <div class="erp-chip__body">
          <span class="erp-chip__num">${cntSkip}</span>
          <span class="erp-chip__txt">Bỏ trống</span>
        </div>
      </div>
      <div class="erp-chip erp-chip--all">
        <div class="erp-chip__dot">Σ</div>
        <div class="erp-chip__body">
          <span class="erp-chip__num">${details.length}</span>
          <span class="erp-chip__txt">Tổng câu</span>
        </div>
      </div>
    </div>
    ${details.length ? '<p class="erp-section-label">Danh sách câu hỏi</p>' : ''}
    ${cardsHtml}`;

  document.getElementById('examReviewContent').parentElement.scrollTop = 0;
};

// ── Đóng trang xem lại ──
window.closeExamReviewPage = function() {
  document.getElementById('examReviewPage').style.display = 'none';
  window.showHistory();
};

// ── Cuộn đến câu hỏi trong trang xem lại ──
window.scrollToReviewQ = function(index) {
  const card = document.getElementById('erp-q-' + index);
  if (!card) return;

  // Đóng panel nav nếu đang mở trên mobile
  const nav = document.getElementById('erpQuestionNav');
  if (nav && nav.classList.contains('active')) {
    window.toggleErpNav();
  }

  // Highlight hiệu ứng nhấn
  card.classList.add('erp-card--highlight');
  setTimeout(() => card.classList.remove('erp-card--highlight'), 1500);

  // Smooth scroll trong erp-body
  const body = card.closest('.erp-body');
  if (body) {
    const offset = card.offsetTop - body.offsetTop - 12;
    body.scrollTo({ top: offset, behavior: 'smooth' });
  } else {
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
};

// ── Thu gọn / Mở rộng bảng danh sách câu hỏi ──
window.toggleErpNav = function() {
  const nav = document.getElementById('erpQuestionNav');
  if (!nav) return;
  const isVisible = nav.classList.contains('active');
  
  if (isVisible) {
    nav.classList.remove('active');
    setTimeout(() => nav.style.display = 'none', 300);
  } else {
    nav.style.display = 'block';
    // Force reflow
    void nav.offsetWidth;
    nav.classList.add('active');
  }
};

// ── Mở AI Gia sư từ trang xem lại ──
window.openAIFromReviewByKey = function(key) {
  const q = window.reviewQuestionStore && window.reviewQuestionStore[key];
  if (!q) { console.warn('reviewStore key not found:', key); return; }
  const idx = parseInt(key.split('_')[0], 10);
  const backup = questionsData.slice();
  if (questionsData.length <= idx) questionsData.length = idx + 1;
  questionsData[idx] = {
    question: q.q || '',
    options:  q.opts || [],
    answer:   q.a   || '',
    explain:  q.ex  || ''
  };
  window.askAIForQuestion(idx);
  setTimeout(() => {
    for (let i = 0; i < backup.length; i++) questionsData[i] = backup[i];
    questionsData.length = backup.length;
  }, 500);
};

// ── Mở xem lại từ trong modal ──
window.openExamReviewFromModal = function(historyId) {
  const m = document.getElementById('historyModal');
  if (m) m.style.display = 'none';
  window.openExamReview(historyId);
};

// ── Mở modal lịch sử (tab Timeline mặc định) ──
window.showHistory = async function() {
  const user = auth.currentUser;
  if (!user) {
    cloudAlert({ title: 'Yêu cầu đăng nhập', message: 'Vui lòng đăng nhập để xem lịch sử.', icon: '🔐' });
    return;
  }
  const modal = document.getElementById('historyModal');
  modal.style.display = 'flex';
  document.getElementById('statsList').innerHTML = `<p style="text-align:center;padding:20px">⏳ Đang tải...</p>`;
  document.getElementById('aiResultBox').style.display = 'none';
  document.getElementById('historyOverview').style.display = 'none';
  document.getElementById('chartContainer').style.display = 'none';
  window.switchHistoryTab('timeline');

  let targetExamName = null;
  if (document.getElementById('statusPanel').style.display !== 'none') {
    targetExamName = document.getElementById('examName').textContent;
  } else if (typeof pendingData !== 'undefined' && pendingData) {
    targetExamName = pendingData.name;
  }

  if (!globalHistoryData.length) await fetchHistoryData(user.uid);

  if (targetExamName) {
    document.getElementById('filterArea').style.display = 'none';
    document.getElementById('currentExamLabel').style.display = 'none';
    document.getElementById('historyModalTitle').textContent = targetExamName;
    document.getElementById('historyOverview').style.display = 'flex';
    renderOverview(targetExamName, globalHistoryData);
    renderChart(targetExamName, globalHistoryData);
    renderStats(targetExamName);
    window.renderTimeline(targetExamName);
  } else {
    document.getElementById('historyModalTitle').textContent = 'Hồ sơ học tập chung';
    document.getElementById('filterArea').style.display = 'flex';
    initStatsFilter();
    renderStats('all');
    window.renderTimeline('all');
  }
};

// ── Timeline với nút Xem lại ──
window.renderTimeline = function(filterName) {
  const list = document.getElementById('timelineList');
  if (!list) return;
  let data = globalHistoryData || [];
  if (filterName && filterName !== 'all') {
    data = data.filter(i => i.examName === filterName || i.examName.includes(filterName));
  }
  if (!data.length) {
    list.innerHTML = `<p style="text-align:center;padding:24px;color:var(--text-muted,#64748b);">Chưa có lịch sử làm bài nào.</p>`;
    return;
  }
  let html = '';
  data.forEach(d => {
    const c = d.percent >= 80 ? '#16a34a' : d.percent >= 50 ? '#d97706' : '#dc2626';
    let dHtml = '';
    if (d.details && d.details.length) {
      dHtml = d.details.map((q, idx) => `
        <div class="hist-q-item ${q.s ? 'hist-correct' : 'hist-wrong'}">
          <div class="hist-q-text"><span style="font-weight:700;color:${q.s ? '#16a34a' : '#dc2626'}">Câu ${idx + 1}:</span> ${q.q}</div>
          <div class="hist-user-ans">${q.s ? '✅' : '❌'} Bạn chọn: <b>${q.u || '(Bỏ trống)'}</b></div>
          ${!q.s ? `<div class="hist-correct-ans">👉 Đáp án đúng: <b>${q.a}</b></div>` : ''}
        </div>`).join('');
    }
    html += `
      <div class="history-card-wrapper" id="card-${d.id}">
        <div class="history-summary" onclick="window.toggleHistoryDetail('${d.id}')">
          <div class="hist-left">
            <div class="hist-name">${d.examName}</div>
            <div class="hist-date">${d.dateStr}</div>
          </div>
          <div class="hist-right">
            <div style="text-align:right;margin-right:8px;">
              <div class="hist-score" style="color:${c}">${d.score}/${d.total}</div>
              <div class="hist-percent" style="background:${c}">${d.percent}%</div>
            </div>
            <button class="btn-review-timeline"
              onclick="event.stopPropagation();window.openExamReviewFromModal('${d.id}')"
              title="Xem lại toàn bộ đáp án">📋 Xem lại</button>
            <div class="hist-arrow">▼</div>
          </div>
        </div>
        <div id="detail-${d.id}" class="history-details-box" style="display:none;">
          ${dHtml || `<p style="padding:12px;text-align:center;color:#64748b;">Không có dữ liệu chi tiết.</p>`}
        </div>
      </div>`;
  });
  list.innerHTML = html;
};

// ── Filter stats ──
window.filterStats = function() {
  const val = document.getElementById('statsFilter').value;
  renderStats(val);
  window.renderTimeline(val);
};


// ================================================================
// FIX: openAIFromReviewByKey — Đảm bảo AI hoạt động từ Review Page
// ================================================================
window.openAIFromReviewByKey = function(key) {
  if (!key) { console.warn('[Review AI] key is empty'); return; }

  const store = window.reviewQuestionStore;
  if (!store || !store[key]) {
    console.warn('[Review AI] key not found in store:', key, 'available:', Object.keys(store || {}));
    cloudAlert({ title: 'Lỗi', message: 'Không tìm thấy dữ liệu câu hỏi. Vui lòng thử lại.', icon: '⚠️' });
    return;
  }

  const q = store[key];
  const idx = parseInt(key.split('_')[0], 10);
  if (isNaN(idx)) { console.warn('[Review AI] invalid index from key:', key); return; }

  // Set questionsData[idx] để askAIForQuestion đọc
  // Không backup/restore vì askAIForQuestion đọc q ngay synchronously ở dòng đầu
  const prevLen = questionsData.length;
  const prevItem = questionsData[idx];

  if (questionsData.length <= idx) {
    questionsData.length = idx + 1;
  }
  questionsData[idx] = {
    question: q.q   || '',
    options:  q.opts || [],
    answer:   q.a   || '',
    explain:  q.ex  || ''
  };

  console.log('[Review AI] Opening AI for idx:', idx, 'q:', q.q && q.q.substring(0, 50));

  // Gọi AI — function này sync đọc questionsData[idx] ngay lập tức
  window.askAIForQuestion(idx);

  // Restore sau 2s (đủ để AI đọc và bắt đầu request)
  setTimeout(() => {
    if (prevItem !== undefined) {
      questionsData[idx] = prevItem;
    } else if (questionsData.length > prevLen) {
      questionsData.length = prevLen;
    }
  }, 2000);
};


// ================================================================
// AI CHAT MODAL — Hội thoại với AI, lưu lịch sử theo câu hỏi
// ================================================================

// ── State ──
window._aiChat = {
  qKey: null,      // Firestore key (hash của câu hỏi)
  qData: null,     // { question, options, answer, explain }
  messages: [],    // [{ role:'user'|'assistant', text, time }]
  loading: false,
  abortCtrl: null
};

// ── Mở chat modal từ Review Page ──
window.openAIFromReviewByKey = async function(key) {
  const store = window.reviewQuestionStore;
  if (!store || !store[key]) {
    cloudAlert({ title: 'Lỗi', message: 'Không tìm thấy dữ liệu câu hỏi.', icon: '⚠️' });
    return;
  }
  const q = store[key];
  const qData = {
    question: q.q    || '',
    options:  q.opts || [],
    answer:   q.a    || '',
    explain:  q.ex   || ''
  };
  const qKey = getSmartKey(qData.question);
  window.openAIChatModal(qKey, qData);
};

// ── Mở chat modal (có thể gọi từ bất kỳ đâu) ──
window.openAIChatModal = async function(qKey, qData) {
  window._aiChat.qKey   = qKey;
  window._aiChat.qData  = qData;
  window._aiChat.loading = false;

  const modal = document.getElementById('aiChatModal');
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  // Hiển thị câu hỏi ở header
  document.getElementById('aiChatQuestion').textContent = qData.question;

  // Load lịch sử từ Firestore
  await window._loadAIChatHistory(qKey);
  window._renderAIChat();

  // Focus vào input
  setTimeout(() => document.getElementById('aiChatInput').focus(), 100);
};

// ── Đóng modal ──
window.closeAIChatModal = function() {
  if (window._aiChat.abortCtrl) window._aiChat.abortCtrl.abort();
  document.getElementById('aiChatModal').style.display = 'none';
  document.body.style.overflow = '';
};

// ── Load lịch sử từ Firestore ──
window._loadAIChatHistory = async function(qKey) {
  window._aiChat.messages = [];
  const user = auth.currentUser;
  if (!user) return;
  try {
    const doc = await db.collection('users').doc(user.uid)
      .collection('ai_chat_history').doc(qKey).get();
    if (doc.exists && doc.data().messages) {
      window._aiChat.messages = doc.data().messages;
    }
  } catch(e) {
    console.warn('[AIChatModal] Load history error:', e);
  }
};

// ── Lưu lịch sử vào Firestore ──
window._saveAIChatHistory = async function() {
  const user = auth.currentUser;
  if (!user) return;
  const qKey = window._aiChat.qKey;
  if (!qKey) return;
  try {
    await db.collection('users').doc(user.uid)
      .collection('ai_chat_history').doc(qKey).set({
        question: window._aiChat.qData.question,
        messages: window._aiChat.messages,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
  } catch(e) {
    console.warn('[AIChatModal] Save history error:', e);
  }
};

// ── Render toàn bộ messages ──
window._renderAIChat = function() {
  const body = document.getElementById('aiChatBody');
  if (!body) return;
  const msgs = window._aiChat.messages;

  if (!msgs.length) {
    body.innerHTML = `
      <div class="aic-empty">
        <span>🧠</span>
        <p>Chào bạn! Tôi là Gia sư AI.</p>
        <p>Hãy hỏi bất cứ điều gì về câu hỏi này.</p>
      </div>`;
    return;
  }

  body.innerHTML = msgs.map((m, i) => {
    const isUser = m.role === 'user';
    const timeStr = m.time ? new Date(m.time).toLocaleTimeString('vi', { hour: '2-digit', minute: '2-digit' }) : '';
    return `
      <div class="aic-msg ${isUser ? 'aic-msg--user' : 'aic-msg--ai'}">
        ${!isUser ? '<div class="aic-avatar">🧠</div>' : ''}
        <div class="aic-bubble">
          <div class="aic-bubble__text">${m.role === 'assistant' ? m.text : escapeHtml(m.text)}</div>
          ${timeStr ? `<div class="aic-bubble__time">${timeStr}</div>` : ''}
        </div>
      </div>`;
  }).join('');

  // Scroll to bottom
  body.scrollTop = body.scrollHeight;
};

// ── Escape HTML cho user messages ──
function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
}

// ── Gửi tin nhắn ──
window.sendAIChatMessage = async function() {
  if (window._aiChat.loading) return;

  const input = document.getElementById('aiChatInput');
  const text  = (input.value || '').trim();
  if (!text) return;

  input.value = '';
  input.style.height = 'auto';

  const qData = window._aiChat.qData;
  const now   = Date.now();

  // Thêm tin nhắn người dùng
  window._aiChat.messages.push({ role: 'user', text, time: now });
  window._renderAIChat();

  // Hiện loading bubble
  window._aiChat.loading = true;
  window._showAITyping();
  document.getElementById('aiChatSendBtn').disabled = true;

  // Build context prompt cho AI
  const optsList = (qData.options || []).map((o,i) => `${String.fromCharCode(65+i)}. ${o}`).join('\n');
  const history  = window._aiChat.messages.slice(0, -1); // Không bao gồm tin vừa gửi

  // Build conversation history cho AI (tối đa 10 turns gần nhất)
  const recentHistory = history.slice(-10);
  let historyText = '';
  recentHistory.forEach(m => {
    if (m.role === 'user')      historyText += `Học sinh: ${m.text}\n`;
    else if (m.role === 'assistant') historyText += `Gia sư AI: ${m.text.replace(/<[^>]+>/g,'')}\n`;
  });

  const systemContext = `Bạn là Gia sư AI thông minh, giải thích câu hỏi trắc nghiệm ngắn gọn, dễ hiểu, thân thiện.

Câu hỏi đang thảo luận:
"${qData.question}"
${optsList ? `\nCác lựa chọn:\n${optsList}` : ''}
${qData.answer ? `\nĐáp án đúng: ${qData.answer}` : ''}
${qData.explain ? `\nGiải thích gốc: ${qData.explain}` : ''}

${historyText ? `Lịch sử hội thoại:\n${historyText}` : ''}
Học sinh vừa hỏi: ${text}

Hãy trả lời trực tiếp, ngắn gọn (dưới 300 từ), dùng markdown nếu cần. Không lặp lại câu hỏi.`;

  try {
    // Abort controller riêng cho chat
    window._aiChat.abortCtrl = new AbortController();
    const result = await callAI(systemContext, window._aiChat.abortCtrl.signal);

    if (result && result.text) {
      // Convert markdown sang HTML đơn giản
      const html = result.text
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`(.+?)`/g, '<code style="background:rgba(0,0,0,.08);padding:1px 5px;border-radius:4px;font-size:13px">$1</code>')
        .replace(/\n\n/g, '</p><p>')
        .replace(/\n/g, '<br>');
      const htmlWrapped = `<p>${html}</p>`;

      window._aiChat.messages.push({ role: 'assistant', text: htmlWrapped, time: Date.now() });
      await window._saveAIChatHistory();
    } else {
      window._aiChat.messages.push({
        role: 'assistant',
        text: '<p style="color:#dc2626">Xin lỗi, có lỗi xảy ra. Vui lòng thử lại.</p>',
        time: Date.now()
      });
    }
  } catch(e) {
    if (e.name !== 'AbortError') {
      window._aiChat.messages.push({
        role: 'assistant',
        text: `<p style="color:#dc2626">Lỗi: ${e.message}</p>`,
        time: Date.now()
      });
    }
  }

  window._aiChat.loading = false;
  document.getElementById('aiChatSendBtn').disabled = false;
  window._renderAIChat();
  document.getElementById('aiChatInput').focus();
};

// ── Hiện typing indicator ──
window._showAITyping = function() {
  const body = document.getElementById('aiChatBody');
  if (!body) return;
  const typing = document.createElement('div');
  typing.className = 'aic-msg aic-msg--ai aic-typing';
  typing.innerHTML = `
    <div class="aic-avatar">🧠</div>
    <div class="aic-bubble">
      <div class="aic-typing-dots">
        <span></span><span></span><span></span>
      </div>
    </div>`;
  body.appendChild(typing);
  body.scrollTop = body.scrollHeight;
};

// ── Xoá lịch sử hội thoại ──
window.clearAIChatHistory = async function() {
  const ok = await cloudAlert({
    type: 'confirm', icon: '🗑️',
    title: 'Xoá lịch sử',
    message: 'Bạn có chắc muốn xoá toàn bộ lịch sử hội thoại cho câu này?',
    confirmText: 'Xoá', cancelText: 'Huỷ'
  });
  if (!ok) return;

  window._aiChat.messages = [];
  const user = auth.currentUser;
  if (user && window._aiChat.qKey) {
    try {
      await db.collection('users').doc(user.uid)
        .collection('ai_chat_history').doc(window._aiChat.qKey).delete();
    } catch(e) { console.warn(e); }
  }
  window._renderAIChat();
};

// ── Enter để gửi (Shift+Enter để xuống dòng) ──
window._aiChatKeydown = function(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    window.sendAIChatMessage();
  }
};

// ── Auto-resize textarea ──
window._aiChatInput = function(e) {
  const el = e.target;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
};


// ================================================================
// AI CHAT MODAL v2 — Tự động giải thích khi mở, hỏi thêm thoải mái
// ================================================================

window._aiChat = {
  qKey: null,
  qData: null,
  messages: [],
  loading: false,
  abortCtrl: null
};

// ── Mở từ Review Page ──
window.openAIFromReviewByKey = async function(key) {
  const store = window.reviewQuestionStore;
  if (!store || !store[key]) {
    cloudAlert({ title: 'Lỗi', message: 'Không tìm thấy dữ liệu câu hỏi.', icon: '⚠️' });
    return;
  }
  const q = store[key];
  window.openAIChatModal(getSmartKey(q.q || ''), {
    question: q.q    || '',
    options:  q.opts || [],
    answer:   q.a    || '',
    explain:  q.ex   || ''
  });
};

// ── Mở modal ──
window.openAIChatModal = async function(qKey, qData) {
  window._aiChat.qKey    = qKey;
  window._aiChat.qData   = qData;
  window._aiChat.loading = false;

  const modal = document.getElementById('aiChatModal');
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  document.getElementById('aiChatQuestion').textContent = qData.question;

  // Load lịch sử từ Firestore
  await window._loadAIChatHistory(qKey);

  // Nếu chưa có lịch sử → AI tự động giải thích ngay
  if (window._aiChat.messages.length === 0) {
    window._renderAIChat();
    await window._autoExplain();
  } else {
    window._renderAIChat();
  }

  window._syncChatProviderSelect();
  setTimeout(() => document.getElementById('aiChatInput').focus(), 200);
};

// ── AI tự động giải thích câu hỏi lần đầu ──
window._autoExplain = async function() {
  const qData = window._aiChat.qData;
  window._aiChat.loading = true;
  window._showAITyping();
  document.getElementById('aiChatSendBtn').disabled = true;

  const optsList = (qData.options || [])
    .map((o, i) => `  ${String.fromCharCode(65 + i)}. ${o}`).join('\n');

  // ── PROMPT CHUẨN cho lần giải thích đầu tiên ──
  const prompt = `Bạn là Gia sư AI chuyên luyện thi thông minh, nhiệt tình và dễ hiểu.

Câu hỏi trắc nghiệm:
"${qData.question}"
${optsList ? `\nCác lựa chọn:\n${optsList}` : ''}
${qData.answer ? `\nĐáp án đúng: ${qData.answer}` : ''}
${qData.explain ? `\nGiải thích tham khảo: ${qData.explain}` : ''}

Hãy giải thích câu hỏi này theo cấu trúc sau (ngắn gọn, súc tích, dễ hiểu):

**Đáp án đúng:** [Nêu đáp án]

**Tại sao đúng:** [Giải thích lý do ngắn gọn, rõ ràng, có thể dùng ví dụ thực tế nếu phù hợp]

**Tại sao các đáp án khác sai:** [Chỉ ra điểm sai của từng lựa chọn sai — nếu có options]

**Ghi nhớ nhanh:** [Một câu mẹo hoặc từ khóa giúp nhớ lâu]

Viết bằng tiếng Việt, thân thiện như gia sư dạy kèm, không dài dòng.`;

  try {
    if (window._aiChat.abortCtrl) window._aiChat.abortCtrl.abort();
    window._aiChat.abortCtrl = new AbortController();
    const result = await callAI(prompt, window._aiChat.abortCtrl.signal);

    if (result && result.text) {
      window._aiChat.messages.push({
        role: 'assistant',
        text: window._mdToHtml(result.text),
        time: Date.now()
      });
      await window._saveAIChatHistory();
    } else {
      window._aiChat.messages.push({
        role: 'assistant',
        text: '<p>Xin lỗi, có lỗi khi tải giải thích. Bạn có thể hỏi trực tiếp bên dưới.</p>',
        time: Date.now()
      });
    }
  } catch (e) {
    if (e.name !== 'AbortError') {
      window._aiChat.messages.push({
        role: 'assistant',
        text: `<p style="color:#dc2626">Lỗi kết nối: ${e.message}</p>`,
        time: Date.now()
      });
    }
  }

  window._aiChat.loading = false;
  document.getElementById('aiChatSendBtn').disabled = false;
  window._renderAIChat();
};

// ── Gửi câu hỏi tiếp theo ──
window.sendAIChatMessage = async function() {
  if (window._aiChat.loading) return;
  const input = document.getElementById('aiChatInput');
  const text  = (input.value || '').trim();
  if (!text) return;

  input.value = '';
  input.style.height = 'auto';

  window._aiChat.messages.push({ role: 'user', text, time: Date.now() });
  window._renderAIChat();
  window._aiChat.loading = true;
  window._showAITyping();
  document.getElementById('aiChatSendBtn').disabled = true;

  const qData = window._aiChat.qData;
  const optsList = (qData.options || [])
    .map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join('\n');

  // ── PROMPT cho câu hỏi tiếp theo (kèm ngữ cảnh) ──
  const recentMsgs = window._aiChat.messages.slice(-8); // 8 tin gần nhất
  let historyText = '';
  recentMsgs.slice(0, -1).forEach(m => {
    const clean = m.text.replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim();
    if (m.role === 'user')      historyText += `Học sinh: ${clean}\n\n`;
    else if (m.role === 'assistant') historyText += `Gia sư AI: ${clean}\n\n`;
  });

  const prompt = `Bạn là Gia sư AI đang giải đáp thắc mắc về câu hỏi trắc nghiệm.

Câu hỏi gốc: "${qData.question}"
${optsList ? `Các lựa chọn:\n${optsList}` : ''}
${qData.answer ? `Đáp án đúng: ${qData.answer}` : ''}

${historyText ? `Hội thoại trước:\n${historyText}` : ''}Học sinh vừa hỏi thêm: "${text}"

Hãy trả lời trực tiếp, ngắn gọn (tối đa 200 từ), đúng trọng tâm câu hỏi. Dùng **in đậm** cho từ khóa quan trọng. Tiếng Việt tự nhiên, thân thiện.`;

  try {
    if (window._aiChat.abortCtrl) window._aiChat.abortCtrl.abort();
    window._aiChat.abortCtrl = new AbortController();
    const result = await callAI(prompt, window._aiChat.abortCtrl.signal);

    window._aiChat.messages.push({
      role: 'assistant',
      text: result && result.text
        ? window._mdToHtml(result.text)
        : '<p style="color:#dc2626">Có lỗi xảy ra. Vui lòng thử lại.</p>',
      time: Date.now()
    });
    await window._saveAIChatHistory();
  } catch (e) {
    if (e.name !== 'AbortError') {
      window._aiChat.messages.push({
        role: 'assistant',
        text: `<p style="color:#dc2626">Lỗi: ${e.message}</p>`,
        time: Date.now()
      });
    }
  }

  window._aiChat.loading = false;
  document.getElementById('aiChatSendBtn').disabled = false;
  window._renderAIChat();
  document.getElementById('aiChatInput').focus();
};

// ── Chuyển Markdown đơn giản → HTML ──
window._mdToHtml = function(text) {
  if (window.marked) return marked.parse(text || "");
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')  // escape trước
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code class="aic-code">$1</code>')
    .replace(/^### (.+)$/gm, '<h4 class="aic-h4">$1</h4>')
    .replace(/^## (.+)$/gm,  '<h3 class="aic-h3">$1</h3>')
    .replace(/^# (.+)$/gm,   '<h2 class="aic-h2">$1</h2>')
    .replace(/^\* (.+)$/gm,  '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, s => `<ul class="aic-ul">${s}</ul>`)
    .replace(/\n\n+/g, '</p><p>')
    .replace(/\n/g, '<br>')
    .replace(/^(?!<[hup])(.+)$/, '<p>$1</p>')
    .replace(/^<\/p><p>/, '')
    .replace(/<p><\/p>/g, '');
};

// ── Render messages ──
window._renderAIChat = function() {
  const body = document.getElementById('aiChatBody');
  if (!body) return;
  // Xoa typing indicator
  body.querySelectorAll('.aic-typing').forEach(el => el.remove());

  const msgs = window._aiChat.messages;
  if (!msgs.length) {
    body.innerHTML = `
      <div class="aic-empty">
        <span>🧠</span>
        <p>Đang chuẩn bị giải thích...</p>
      </div>`;
    return;
  }

  body.innerHTML = msgs.map(m => {
    const isUser = m.role === 'user';
    const timeStr = m.time
      ? new Date(m.time).toLocaleTimeString('vi', { hour: '2-digit', minute: '2-digit' })
      : '';
    const textHtml = isUser
      ? m.text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')
      : m.text;
    return `
      <div class="aic-msg ${isUser ? 'aic-msg--user' : 'aic-msg--ai'}">
        ${!isUser ? '<div class="aic-avatar">🧠</div>' : ''}
        <div class="aic-bubble">
          <div class="aic-bubble__text">${textHtml}</div>
          ${timeStr ? `<div class="aic-bubble__time">${timeStr}</div>` : ''}
        </div>
      </div>`;
  }).join('');

  body.scrollTop = body.scrollHeight;
};

// ── Typing indicator ──
window._showAITyping = function() {
  const body = document.getElementById('aiChatBody');
  if (!body) return;
  body.querySelectorAll('.aic-typing').forEach(el => el.remove());
  const el = document.createElement('div');
  el.className = 'aic-msg aic-msg--ai aic-typing';
  el.innerHTML = `
    <div class="aic-avatar">🧠</div>
    <div class="aic-bubble">
      <div class="aic-bubble__text">
        <div class="aic-typing-dots"><span></span><span></span><span></span></div>
      </div>
    </div>`;
  body.appendChild(el);
  body.scrollTop = body.scrollHeight;
};

// ── Load / Save Firestore ──
window._loadAIChatHistory = async function(qKey) {
  window._aiChat.messages = [];
  const user = auth.currentUser;
  if (!user) return;
  try {
    const doc = await db.collection('users').doc(user.uid)
      .collection('ai_chat_history').doc(qKey).get();
    if (doc.exists && Array.isArray(doc.data().messages)) {
      window._aiChat.messages = doc.data().messages;
    }
  } catch(e) { console.warn('[AIChatModal] load:', e); }
};

window._saveAIChatHistory = async function() {
  const user = auth.currentUser;
  if (!user || !window._aiChat.qKey) return;
  try {
    await db.collection('users').doc(user.uid)
      .collection('ai_chat_history').doc(window._aiChat.qKey).set({
        question:  window._aiChat.qData.question,
        messages:  window._aiChat.messages,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
  } catch(e) { console.warn('[AIChatModal] save:', e); }
};

// ── Đóng modal ──
window.closeAIChatModal = function() {
  if (window._aiChat.abortCtrl) window._aiChat.abortCtrl.abort();
  document.getElementById('aiChatModal').style.display = 'none';
  document.body.style.overflow = '';
};

// ── Xoá lịch sử ──
window.clearAIChatHistory = async function() {
  const ok = await cloudAlert({
    type: 'confirm', icon: '🗑️',
    title: 'Xoá lịch sử hội thoại',
    message: 'Toàn bộ hội thoại với câu này sẽ bị xoá. Lần sau mở lại AI sẽ giải thích lại từ đầu.',
    confirmText: 'Xoá', cancelText: 'Huỷ'
  });
  if (!ok) return;
  window._aiChat.messages = [];
  const user = auth.currentUser;
  if (user && window._aiChat.qKey) {
    try {
      await db.collection('users').doc(user.uid)
        .collection('ai_chat_history').doc(window._aiChat.qKey).delete();
    } catch(e) { console.warn(e); }
  }
  window._renderAIChat();
  // Tự động giải thích lại
  await window._autoExplain();
};

// ── Input handlers ──
window._aiChatKeydown = function(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    window.sendAIChatMessage();
  }
};
window._aiChatInput = function(e) {
  const el = e.target;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
};

// ── Đổi AI provider trong chat ──
window._switchChatAIProvider = function(provider) {
  if (provider === 'gemini' || provider === 'groq') {
    AI_PROVIDER = provider;
    updateAIUI();
    console.log('[AIChatModal] Switched to:', provider);
  }
};

// ── Đồng bộ dropdown chọn AI khi mở modal ──
window._syncChatProviderSelect = function() {
  const sel = document.getElementById('aiChatProviderSelect');
  if (sel) sel.value = AI_PROVIDER;
};


// ================================================================
// FIX: openExamReview — Logic so sánh đáp án chắc chắn hơn
// ================================================================
window.openExamReview = async function(historyId) {
  const user = auth.currentUser;
  if (!user) return;

  const modal = document.getElementById('historyModal');
  if (modal) modal.style.display = 'none';

  const page = document.getElementById('examReviewPage');
  page.style.display = 'flex';

  document.getElementById('reviewPageExamName').textContent = 'Đang tải...';
  document.getElementById('reviewPageDate').textContent = '';
  const badge = document.getElementById('reviewPageScoreBadge');
  badge.className = 'erp-score-pill';
  badge.innerHTML = '';

  document.getElementById('examReviewContent').innerHTML = `
    <div class="erp-loading">
      <div class="erp-spinner"></div>
      <span>Đang tải dữ liệu bài thi...</span>
    </div>`;

  let attempt = (globalHistoryData || []).find(h => h.id === historyId);
  if (!attempt) {
    try {
      const snap = await db.collection('users').doc(user.uid)
        .collection('history').doc(historyId).get();
      if (snap.exists) attempt = { id: snap.id, ...snap.data() };
    } catch (e) {
      document.getElementById('examReviewContent').innerHTML = `
        <div class="erp-empty">
          <span class="erp-empty__icon">⚠️</span>
          <p class="erp-empty__title">Lỗi tải dữ liệu</p>
          <p class="erp-empty__desc">Kiểm tra kết nối mạng và thử lại.</p>
        </div>`;
      return;
    }
  }
  if (!attempt) {
    document.getElementById('examReviewContent').innerHTML = `
      <div class="erp-empty">
        <span class="erp-empty__icon">📭</span>
        <p class="erp-empty__title">Không tìm thấy bài thi</p>
        <p class="erp-empty__desc">Bài thi này có thể đã bị xóa.</p>
      </div>`;
    return;
  }

  // Header
  document.getElementById('reviewPageExamName').textContent = attempt.examName || 'Bài thi';
  document.getElementById('reviewPageDate').textContent = '📅 ' + (attempt.dateStr || '');

  const p = attempt.percent || 0;
  const gradeClass = p >= 80 ? 'grade-great' : p >= 50 ? 'grade-ok' : 'grade-bad';
  const gradeLabel = p >= 90 ? 'Xuất sắc' : p >= 80 ? 'Giỏi' : p >= 60 ? 'Khá' : p >= 50 ? 'Trung bình' : 'Cần cố gắng';
  badge.className = 'erp-score-pill ' + gradeClass;
  badge.innerHTML = `
    <span class="erp-score-pill__num">${attempt.score}/${attempt.total}</span>
    <span class="erp-score-pill__meta">
      <span class="erp-score-pill__pct">${p}%</span>
      <span class="erp-score-pill__lbl">${gradeLabel}</span>
    </span>`;

  const details = attempt.details || [];
  const cntOk   = details.filter(q => q.s).length;
  const cntBad  = details.filter(q => !q.s && q.u).length;
  const cntSkip = details.filter(q => !q.u).length;

  window.reviewQuestionStore = {};

  // ── Helper: kiểm tra option có phải đáp án đúng không ──
  // Hỗ trợ cả 2 format: text đầy đủ và chữ cái A/B/C/D
  function isCorrectOpt(opt, letterIndex, ans) {
    const letter = String.fromCharCode(65 + letterIndex); // A,B,C,D...
    const ansTrim = (ans || '').trim();
    const optTrim = (opt || '').trim();
    if (!ansTrim) return false;
    // So sánh text đầy đủ (normalize)
    if (optTrim.toLowerCase() === ansTrim.toLowerCase()) return true;
    // So sánh chữ cái (A, B, C, D)
    if (ansTrim.toUpperCase() === letter) return true;
    // So sánh "A." hoặc "A)"
    if (ansTrim.replace(/[.)]/g,'').toUpperCase() === letter) return true;
    return false;
  }

  function isUserPickOpt(opt, letterIndex, sel) {
    const letter = String.fromCharCode(65 + letterIndex);
    const selTrim = (sel || '').trim();
    const optTrim = (opt || '').trim();
    if (!selTrim) return false;
    if (optTrim.toLowerCase() === selTrim.toLowerCase()) return true;
    if (selTrim.toUpperCase() === letter) return true;
    if (selTrim.replace(/[.)]/g,'').toUpperCase() === letter) return true;
    return false;
  }

  let cardsHtml = '';

  if (!details.length) {
    cardsHtml = `
      <div class="erp-empty">
        <span class="erp-empty__icon">📋</span>
        <p class="erp-empty__title">Không có dữ liệu chi tiết</p>
        <p class="erp-empty__desc">Bài thi này chưa lưu dữ liệu từng câu.<br>Hãy làm lại để xem kết quả đầy đủ.</p>
      </div>`;
  } else {
    details.forEach((q, i) => {
      const key = i + '_' + historyId.substring(0, 8);
      window.reviewQuestionStore[key] = q;

      const ok   = !!q.s;
      const skip = !q.u;
      const mod  = skip ? 'erp-card--skip' : ok ? 'erp-card--ok' : 'erp-card--bad';
      const label = skip ? 'Bỏ trống' : ok ? 'Đúng ✓' : 'Sai ✗';

      const opts = Array.isArray(q.opts) ? q.opts : [];
      const ans  = (q.a || '').trim();
      const sel  = (q.u || '').trim();

      // ── Render options ──
      let optsHtml = '';

      if (opts.length > 0) {
        // Có danh sách options đầy đủ
        optsHtml = '<div class="erp-options">';
        opts.forEach((opt, oi) => {
          const isAns = isCorrectOpt(opt, oi, ans);
          const isSel = isUserPickOpt(opt, oi, sel);
          const isBad = isSel && !isAns;

          let cls = '', keyContent = String.fromCharCode(65 + oi), labelHtml = '';
          if (isAns && isSel) {
            cls = 'erp-opt--ok';
            keyContent = '✓';
            labelHtml = `<span class="erp-opt__label">Đúng ✓</span>`;
          } else if (isAns) {
            cls = 'erp-opt--ok';
            keyContent = '✓';
            labelHtml = `<span class="erp-opt__label">Đáp án đúng</span>`;
          } else if (isBad) {
            cls = 'erp-opt--bad';
            keyContent = '✗';
            labelHtml = `<span class="erp-opt__label">Bạn chọn</span>`;
          } else {
            keyContent = String.fromCharCode(65 + oi);
          }

          optsHtml += `
            <div class="erp-opt ${cls}">
              <span class="erp-opt__key">${keyContent}</span>
              <span class="erp-opt__text">${opt}</span>
              ${labelHtml}
            </div>`;
        });
        optsHtml += '</div>';

      } else {
        // Không có opts (bài thi cũ) — hiển thị dạng text
        optsHtml = '<div class="erp-options">';
        if (sel) {
          const cls = ok ? 'erp-opt--ok' : 'erp-opt--bad';
          const icon = ok ? '✓' : '✗';
          const lbl = ok
            ? `<span class="erp-opt__label">Đúng ✓</span>`
            : `<span class="erp-opt__label">Bạn chọn</span>`;
          optsHtml += `<div class="erp-opt ${cls}"><span class="erp-opt__key">${icon}</span><span class="erp-opt__text">${sel}</span>${lbl}</div>`;
        }
        if (!ok && ans) {
          optsHtml += `<div class="erp-opt erp-opt--ok"><span class="erp-opt__key">✓</span><span class="erp-opt__text">${ans}</span><span class="erp-opt__label">Đáp án đúng</span></div>`;
        }
        if (!sel && !ans) {
          optsHtml += `<div class="erp-opt"><span class="erp-opt__key">–</span><span class="erp-opt__text" style="color:var(--text-muted)">Bài thi cũ chưa lưu lựa chọn. Hãy làm lại để xem đầy đủ.</span></div>`;
        }
        optsHtml += '</div>';
      }

      const explainHtml = q.ex
        ? `<div class="erp-explain"><span class="erp-explain__bulb">💡</span><span class="erp-explain__text"><b>Giải thích:</b> ${q.ex}</span></div>`
        : '';

      cardsHtml += `
        <div class="erp-card ${mod}" id="erp-q-${i}">
          <div class="erp-card__strip"></div>
          <div class="erp-card__body">
            <div class="erp-card__row">
              <div class="erp-card__idx">${i + 1}</div>
              <div class="erp-card__q">${q.q}</div>
              <span class="erp-card__tag">${label}</span>
            </div>
            ${optsHtml}
            ${explainHtml}
            <button class="erp-ai-btn" onclick="window.openAIFromReviewByKey('${key}')">🧠 Hỏi Gia sư AI</button>
          </div>
        </div>`;
    });
  }

  document.getElementById('examReviewContent').innerHTML = `
    <div class="erp-chips">
      <div class="erp-chip erp-chip--ok">
        <div class="erp-chip__dot">✓</div>
        <div class="erp-chip__body">
          <span class="erp-chip__num">${cntOk}</span>
          <span class="erp-chip__txt">Chính xác</span>
        </div>
      </div>
      <div class="erp-chip erp-chip--bad">
        <div class="erp-chip__dot">✗</div>
        <div class="erp-chip__body">
          <span class="erp-chip__num">${cntBad}</span>
          <span class="erp-chip__txt">Sai</span>
        </div>
      </div>
      <div class="erp-chip erp-chip--skip">
        <div class="erp-chip__dot">–</div>
        <div class="erp-chip__body">
          <span class="erp-chip__num">${cntSkip}</span>
          <span class="erp-chip__txt">Bỏ trống</span>
        </div>
      </div>
      <div class="erp-chip erp-chip--all">
        <div class="erp-chip__dot">Σ</div>
        <div class="erp-chip__body">
          <span class="erp-chip__num">${details.length}</span>
          <span class="erp-chip__txt">Tổng câu</span>
        </div>
      </div>
    </div>
    ${details.length ? '<p class="erp-section-label">Danh sách câu hỏi</p>' : ''}
    ${cardsHtml}`;

  document.getElementById('examReviewContent').parentElement.scrollTop = 0;

  // ── Render Question Navigation Grid ──
  const navGrid = document.getElementById('erpNavGrid');
  const navWrapper = document.getElementById('erpQuestionNav');
  const navFab = document.getElementById('erpNavFab');
  const navBadge = document.getElementById('erpNavFabBadge');
  const navSummary = document.getElementById('erpNavSummary');
  
  if (navGrid && details.length) {
    let navHtml = '';
    details.forEach((q, i) => {
      const ok   = !!q.s;
      const skip = !q.u;
      const cls  = skip ? 'erp-qnav__btn--skip' : ok ? 'erp-qnav__btn--ok' : 'erp-qnav__btn--bad';
      navHtml += `<button class="erp-qnav__btn ${cls}" onclick="window.scrollToReviewQ(${i})" title="Câu ${i + 1} — ${skip ? 'Bỏ trống' : ok ? 'Đúng' : 'Sai'}">${i + 1}</button>`;
    });
    navGrid.innerHTML = navHtml;
    
    if (navBadge) navBadge.textContent = details.length;
    if (navSummary) navSummary.innerHTML = `<span style="color:#10b981">${cntOk}</span> / <span style="color:#ef4444">${cntBad}</span> / <span style="color:#f59e0b">${cntSkip}</span>`;
    
    // Chỉ hiện FAB, ẩn panel ban đầu
    navWrapper.style.display = 'none';
    navWrapper.classList.remove('active');
    if (navFab) navFab.style.display = 'flex';
  } else {
    if (navGrid) navGrid.innerHTML = '';
    if (navWrapper) navWrapper.style.display = 'none';
    if (navFab) navFab.style.display = 'none';
  }
};
