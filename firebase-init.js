// firebase-init.js
// Firebase для статического сайта (GitHub Pages), без npm/сборщика.
// Модули: Auth (вход/регистрация) + Firestore (синхронизация между устройствами).
// Подключается как <script type="module" src="firebase-init.js"></script>

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  signOut,
  onAuthStateChanged,
  fetchSignInMethodsForEmail,
  deleteUser
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  initializeFirestore,
  runTransaction,
  doc,
  collection,
  query,
  where,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  writeBatch,
  onSnapshot,
  serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

// Публичный ключ веб-приложения — не секретный, доступ ограничивается
// правилами безопасности Firestore/Auth, а не секретностью ключа.
const firebaseConfig = {
  apiKey: "AIzaSyDun61xJtTxjhWELGzDvXoblRGwFxVzWUk",
  authDomain: "next-cube-pro.firebaseapp.com",
  projectId: "next-cube-pro",
  storageBucket: "next-cube-pro.firebasestorage.app",
  messagingSenderId: "163503165809",
  appId: "1:163503165809:web:6d3c46e956ca04b5aca6d0"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
// ignoreUndefinedProperties: a solve with a single `undefined` field would
// otherwise make setDoc() throw forever (and keep the solve stuck in the
// pending queue).
const db = initializeFirestore(app, { ignoreUndefinedProperties: true });
const googleProvider = new GoogleAuthProvider();

// Локальный счётчик операций Firestore ЗА ДЕНЬ на этом устройстве — чтобы
// видеть реальный расход квоты: в консоли браузера CubeSync.getUsage().
// Это только оценка (без запросов к usernames и без других устройств).
const USAGE_KEY = "fbUsageToday";
function usageBump(kind, n = 1) {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const cur = JSON.parse(localStorage.getItem(USAGE_KEY) || "{}");
    const u = cur.day === day ? cur : { day, reads: 0, writes: 0, deletes: 0 };
    u[kind] = (u[kind] || 0) + n;
    localStorage.setItem(USAGE_KEY, JSON.stringify(u));
  } catch (_) { /* счётчик необязателен */ }
}
// Запрос, вернувший 0 документов, всё равно стоит 1 чтение.
const readCost = (snap) => Math.max(1, snap.size);

// Ники хранятся в нижнем регистре как id документа в коллекции
// "usernames" -> { uid, email }. Это и обеспечивает уникальность,
// и позволяет резолвить "ник или почта" в реальный email для входа.
const normalizeNickname = (nick) => nick.trim().toLowerCase();

// Ник становится id документа Firestore, поэтому нельзя допускать "/",
// "." / "..", и шаблон __имя__ (зарезервирован Firestore).
function validateNickname(nick) {
  const value = String(nick ?? "").trim();
  const bad =
    value.length < 2 ||
    value.length > 32 ||
    /[\/\\\u0000-\u001f\u007f]/.test(value) ||
    value === "." ||
    value === ".." ||
    /^__.*__$/.test(value);
  if (bad) {
    const err = new Error("Invalid nickname");
    err.code = "invalid-nickname";
    throw err;
  }
  return value;
}

function nicknameInUseError() {
  const err = new Error("Nickname already taken");
  err.code = "nickname-in-use";
  return err;
}

// Атомарное резервирование ника: проверка и запись в одной транзакции,
// чтобы два человека не могли занять один ник одновременно.
async function reserveNickname(nickname, uid, email) {
  const ref = doc(db, "usernames", normalizeNickname(nickname));
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists() && snap.data().uid !== uid) throw nicknameInUseError();
    tx.set(ref, { uid, email });
  });
}

async function findEmailByNickname(nickname) {
  const snap = await getDoc(doc(db, "usernames", normalizeNickname(nickname)));
  return snap.exists() ? snap.data().email : null;
}

// --- Публичный интерфейс для обычных (не-module) скриптов ---
window.CubeAuth = {
  // Регистрация: ник + email + пароль.
  // Бросает Error с .code === 'nickname-in-use', если ник занят,
  // 'invalid-nickname', если ник нельзя использовать как id,
  // либо обычный Firebase error.code (auth/email-already-in-use и т.п.).
  registerWithNickname: async (nicknameRaw, email, password) => {
    const nickname = validateNickname(nicknameRaw);
    // Дешёвая предпроверка (1 чтение), чтобы в обычном случае не создавать
    // аккаунт зря. Окончательное решение принимает транзакция ниже.
    const taken = await getDoc(doc(db, "usernames", normalizeNickname(nickname)));
    if (taken.exists()) throw nicknameInUseError();

    const cred = await createUserWithEmailAndPassword(auth, email, password);
    try {
      await reserveNickname(nickname, cred.user.uid, email);
    } catch (e) {
      // Проиграли гонку за ник (или сеть отвалилась): не оставляем аккаунт
      // без профиля — удаляем только что созданного пользователя.
      try { await deleteUser(cred.user); } catch (_) { /* ничего не поделать */ }
      throw e;
    }
    await updateProfile(cred.user, { displayName: nickname });
    await setDoc(doc(db, "users", cred.user.uid), { nickname, email }, { merge: true });
    return cred.user;
  },

  // "Ник или почта" -> реальный email для signIn. null, если ника нет.
  resolveEmailForLogin: async (loginId) => {
    if (loginId.includes("@")) return loginId;
    return findEmailByNickname(loginId);
  },

  loginWithEmail: (email, password) =>
    signInWithEmailAndPassword(auth, email, password),

  // Список способов входа, привязанных к email (['password'], ['google.com'], ...).
  // Используется, чтобы объяснить пользователю, почему "неверный пароль",
  // если на самом деле аккаунт создан через Google и пароля не имеет.
  getSignInMethods: async (email) => {
    try {
      return await fetchSignInMethodsForEmail(auth, email);
    } catch (e) {
      return [];
    }
  },

  loginWithGoogle: () => signInWithPopup(auth, googleProvider),

  // Для входа через Google своего "ника" нет — придумываем на основе
  // имени/почты и сохраняем при первом входе, чтобы дальше можно было
  // логиниться по нему тоже.
  ensureUserProfile: async (user) => {
    const existing = await getDoc(doc(db, "users", user.uid));
    if (existing.exists() && existing.data().nickname) {
      return existing.data().nickname;
    }
    let base = String(user.displayName || user.email.split("@")[0] || "")
      .replace(/\s+/g, "")
      .replace(/[\/\\\u0000-\u001f\u007f]/g, "")
      .toLowerCase()
      .slice(0, 28);
    if (base.length < 2 || base === "." || base === ".." || /^__.*__$/.test(base)) base = "user";
    let nickname = base;
    let n = 1;
    // Каждая попытка — атомарная транзакция (а не getDoc-цикл + setDoc).
    for (;;) {
      try {
        await reserveNickname(nickname, user.uid, user.email);
        break;
      } catch (e) {
        if (e.code === "nickname-in-use" && n < 500) {
          nickname = `${base}${n++}`;
          continue;
        }
        throw e;
      }
    }
    await setDoc(doc(db, "users", user.uid), { nickname, email: user.email }, { merge: true });
    return nickname;
  },

  logout: () => signOut(auth),

  getCurrentUser: () => auth.currentUser,

  // Short-lived Firebase ID token for authenticated custom backends
  // (for example the Cloudflare Worker used by the leaderboard).
  getIdToken: (forceRefresh = false) => {
    if (!auth.currentUser) throw new Error("Пользователь не авторизован");
    return auth.currentUser.getIdToken(forceRefresh);
  },

  onAuthChange: (callback) => onAuthStateChanged(auth, callback),

  // Сменить ник у уже вошедшего пользователя. Всё (проверка нового ника,
  // резервирование, освобождение старого, запись в профиль) — одна
  // транзакция: при сбое посередине не останется два занятых ника.
  // Бросает Error с .code === 'nickname-in-use' / 'invalid-nickname'.
  changeNickname: async (newNicknameRaw) => {
    const user = auth.currentUser;
    if (!user) throw new Error("Пользователь не авторизован");
    const newNickname = validateNickname(newNicknameRaw);
    const newKey = normalizeNickname(newNickname);
    const userRef = doc(db, "users", user.uid);
    const newRef = doc(db, "usernames", newKey);

    await runTransaction(db, async (tx) => {
      const newSnap = await tx.get(newRef);
      const userSnap = await tx.get(userRef);
      if (newSnap.exists() && newSnap.data().uid !== user.uid) throw nicknameInUseError();

      const oldNickname = userSnap.exists() ? userSnap.data().nickname : null;
      const oldKey = oldNickname ? normalizeNickname(oldNickname) : null;
      let oldSnap = null;
      if (oldKey && oldKey !== newKey) oldSnap = await tx.get(doc(db, "usernames", oldKey));

      tx.set(newRef, { uid: user.uid, email: user.email });
      tx.set(userRef, { nickname: newNickname }, { merge: true });
      // Старый ник освобождаем только если он действительно наш.
      if (oldSnap?.exists() && oldSnap.data().uid === user.uid) tx.delete(oldSnap.ref);
    });

    await updateProfile(user, { displayName: newNickname });
    return newNickname;
  }
};

window.CubeSync = {
  // Сохранить данные пользователя (solves, настройки и т.п.) в Firestore
  saveUserData: async (data) => {
    const user = auth.currentUser;
    if (!user) throw new Error("Пользователь не авторизован");
    await setDoc(doc(db, "users", user.uid), data, { merge: true });
    usageBump("writes");
  },

  // Разово получить сохранённые данные пользователя
  loadUserData: async () => {
    const user = auth.currentUser;
    if (!user) throw new Error("Пользователь не авторизован");
    const snap = await getDoc(doc(db, "users", user.uid));
    usageBump("reads");
    return snap.exists() ? snap.data() : null;
  },

  // Public daily challenge. The Firestore document id is the local calendar
  // date in YYYY-MM-DD format, e.g. dailyChallenge/2026-08-07.
  loadDailyChallenge: async (dateKey) => {
    const snap = await getDoc(doc(db, "dailyChallenge", dateKey));
    usageBump("reads");
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  },

  // Живая подписка на изменения (в т.ч. с другого устройства).
  // Возвращает функцию отписки. Колбэк получает (data, { pending, fromCache }):
  // pending === true — это "эхо" нашей собственной ещё не подтверждённой
  // записи, его не нужно заново сливать в локальное состояние.
  // Каждый серверный снимок стоит 1 чтение.
  subscribeUserData: (callback, onError) => {
    const user = auth.currentUser;
    if (!user) throw new Error("Пользователь не авторизован");
    return onSnapshot(
      doc(db, "users", user.uid),
      (snap) => {
        if (!snap.metadata.hasPendingWrites && !snap.metadata.fromCache) usageBump("reads");
        callback(snap.exists() ? snap.data() : null, {
          pending: snap.metadata.hasPendingWrites,
          fromCache: snap.metadata.fromCache
        });
      },
      (error) => { if (onError) onError(error); else console.error("subscribeUserData:", error); }
    );
  },

  // Счётчик операций за сегодня на этом устройстве (см. usageBump).
  getUsage: () => {
    try { return JSON.parse(localStorage.getItem(USAGE_KEY) || "{}"); } catch (_) { return {}; }
  },

  // ---------------------------------------------------------------
  // Точечная работа со сборками: каждый solve — отдельный документ
  // в users/{uid}/solves/{solveId}, а не поле в одном большом блобе.
  // Это даёт ровно 1 read/write за операцию вместо перезаписи всей
  // истории целиком. Полную историю (loadAllSolvesOnce) читаем всего
  // один раз за всё время на устройство+аккаунт; после этого — только
  // loadSolvesSince (дельта), см. комментарий над ней.
  // ---------------------------------------------------------------

  // ВСЯ история сборок + список "надгробий" удалений. Вызывается ровно
  // один раз за всё время для конкретного устройства+аккаунта — когда
  // ещё нет локальной метки lastSyncedAt (sync.js, AppSync.runSync).
  // После этого первого раза используется loadSolvesSince ниже.
  loadAllSolvesOnce: async () => {
    const user = auth.currentUser;
    if (!user) throw new Error("Пользователь не авторизован");
    const [solvesSnap, tombstonesSnap] = await Promise.all([
      getDocs(collection(db, "users", user.uid, "solves")),
      getDocs(collection(db, "users", user.uid, "tombstones"))
    ]);
    usageBump("reads", readCost(solvesSnap) + readCost(tombstonesSnap));
    const solves = solvesSnap.docs.map(d => {
      const data = d.data();
      return { id: d.id, ...data, cloudUpdatedAt: data.cloudUpdatedAt?.toMillis?.() || 0 };
    });
    const tombstones = tombstonesSnap.docs.map(d => {
      const data = d.data();
      return { id: d.id, deletedAt: data.deletedAt, cloudDeletedAt: data.cloudDeletedAt?.toMillis?.() || 0 };
    });
    return { solves, tombstones };
  },

  // Дельта-версия loadAllSolvesOnce: вместо ВСЕЙ истории читает только
  // то, что изменилось после sinceTimestamp (по полю updatedAt у solve
  // и deletedAt у tombstone — оба уже проставляются при каждой записи).
  // Это то, что не даёт стоимости логина расти вместе с общим объёмом
  // истории пользователя: цена визита = кол-во НОВОГО/ИЗМЕНЁННОГО,
  // а не кол-во всего, что у него когда-либо было решено.
  loadSolvesSince: async (sinceTimestamp) => {
    const user = auth.currentUser;
    if (!user) throw new Error("Пользователь не авторизован");
    // Курсор хранится в миллисекундах, а серверная метка Firestore точнее
    // (микросекунды): документ с меткой 12:00:00.123456 при курсоре
    // ...123 строго "больше" курсора и перечитывался бы при КАЖДОЙ
    // синхронизации. +1 мс исключает перечитывание уже виденного документа.
    const cursor = Timestamp.fromMillis(Math.max(0, Math.floor(Number(sinceTimestamp) || 0)) + 1);
    const [solvesSnap, tombstonesSnap] = await Promise.all([
      getDocs(query(collection(db, "users", user.uid, "solves"), where("cloudUpdatedAt", ">", cursor))),
      getDocs(query(collection(db, "users", user.uid, "tombstones"), where("cloudDeletedAt", ">", cursor)))
    ]);
    usageBump("reads", readCost(solvesSnap) + readCost(tombstonesSnap));
    const solves = solvesSnap.docs.map(d => {
      const data = d.data();
      return { id: d.id, ...data, cloudUpdatedAt: data.cloudUpdatedAt?.toMillis?.() || 0 };
    });
    const tombstones = tombstonesSnap.docs.map(d => {
      const data = d.data();
      return { id: d.id, deletedAt: data.deletedAt, cloudDeletedAt: data.cloudDeletedAt?.toMillis?.() || 0 };
    });
    return { solves, tombstones };
  },

  // Ровно 1 write: новый solve целиком (создание).
  saveSolve: async (sessionId, solve) => {
    const user = auth.currentUser;
    if (!user) throw Object.assign(new Error("Пользователь не авторизован"), { code: "auth-required" });
    const { cloudUpdatedAt, ...cleanSolve } = solve;
    await setDoc(doc(db, "users", user.uid, "solves", solve.id), { ...cleanSolve, sessionId, cloudUpdatedAt: serverTimestamp() });
    usageBump("writes");
  },

  // Массовая запись (импорт / восстановление). Лимит Firestore — 500 операций
  // на batch. batch.commit() атомарен: если он не бросил ошибку, все документы
  // записаны. Раньше после этого делался ещё и запрос "проверить, что всё
  // сохранилось" — он читал ВСЕ сборки сессии и удваивал стоимость импорта.
  saveSolvesBatch: async (sessionId, solves) => {
    const user = auth.currentUser;
    if (!user) throw new Error("Пользователь не авторизован");
    const valid = (solves || []).filter(s => s?.id);
    for (let offset = 0; offset < valid.length; offset += 450) {
      const batch = writeBatch(db);
      for (const solve of valid.slice(offset, offset + 450)) {
        const { cloudUpdatedAt, ...cleanSolve } = solve;
        batch.set(doc(db, "users", user.uid, "solves", solve.id), { ...cleanSolve, sessionId, cloudUpdatedAt: serverTimestamp() });
      }
      await batch.commit();
      usageBump("writes", Math.min(450, valid.length - offset));
    }
    return valid.length;
  },

  // Ровно 1 write: точечное изменение полей существующего solve
  // (DNF/+2/ручное редактирование времени). Не трогает остальные
  // документы и не перезаписывает solve целиком.
  updateSolve: async (solveId, patch) => {
    const user = auth.currentUser;
    if (!user) throw Object.assign(new Error("Пользователь не авторизован"), { code: "auth-required" });
    await updateDoc(doc(db, "users", user.uid, "solves", solveId), { ...patch, cloudUpdatedAt: serverTimestamp() });
    usageBump("writes");
  },

  // Ровно 1 delete + 1 write (надгробие), атомарно через batch —
  // чтобы другие устройства при следующем логине узнали об удалении
  // и не "воскресили" solve при слиянии.
  deleteSolveRemote: async (solveId) => {
    const user = auth.currentUser;
    if (!user) throw Object.assign(new Error("Пользователь не авторизован"), { code: "auth-required" });
    const batch = writeBatch(db);
    batch.delete(doc(db, "users", user.uid, "solves", solveId));
    batch.set(doc(db, "users", user.uid, "tombstones", solveId), { deletedAt: Date.now(), cloudDeletedAt: serverTimestamp() });
    await batch.commit();
    usageBump("writes", 2);
  },

  // Метаданные сессий (имя, дисциплина и т.п.) БЕЗ массивов solves —
  // маленький документ, который почти не растёт и меняется редко
  // (создание/переименование/удаление сессии), в отличие от истории
  // сборок.
  // Фразы комментатора записываются ЦЕЛИКОМ (mergeFields заменяет поле
  // customPhrases полностью). Обычный setDoc(..., {merge:true}) сливает
  // вложенные карты по ключам: когда удалялась последняя фраза категории,
  // ключ категории пропадал локально, но в облаке оставался со старым
  // списком — удаление не доезжало до других устройств (и фраза
  // "воскресала" при следующей синхронизации).
  saveCustomPhrases: async (customPhrases, customPhrasesUpdatedAt) => {
    const user = auth.currentUser;
    if (!user) throw new Error("Пользователь не авторизован");
    await setDoc(
      doc(db, "users", user.uid),
      { customPhrases, customPhrasesUpdatedAt },
      { mergeFields: ["customPhrases", "customPhrasesUpdatedAt"] }
    );
    usageBump("writes");
  },

  saveSessionsMeta: async (meta) => {
    const user = auth.currentUser;
    if (!user) return;
    await setDoc(doc(db, "users", user.uid), meta, { merge: true });
    usageBump("writes");
  }
};

// При старте страницы, если Firebase сам восстановил сессию
// (стандартное поведение — сессия хранится в браузере), запускаем
// полный ресинк один раз. AppSync.runSync() сам читает и метаданные,
// и историю сборок — второй getDoc здесь был бы лишним чтением.
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.AppSync?.stopCustomPhrasesLiveSync?.();
    window.dispatchEvent(new CustomEvent("firebase-auth-state", { detail: { user: null } }));
    return;
  }
  // AppSync and the timer may still be loading. The sync layer listens for
  // this event and starts as soon as all three pieces are ready.
  window.dispatchEvent(new CustomEvent("firebase-auth-state", { detail: { user } }));
});

window.dispatchEvent(new Event("firebase-ready"));