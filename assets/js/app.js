(async () => {
  window.showToast = function(msg, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `studyflow-toast toast-${type}`;
    toast.innerHTML = `<i data-lucide="info"></i><span>${escapeHtml(msg)}</span>`;
    document.body.appendChild(toast);
    if (window.lucide) window.lucide.createIcons();
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  };

  const initialDashboardGrid = document.getElementById('dashboardContinueWatching');
  if (initialDashboardGrid) {
    initialDashboardGrid.innerHTML = '<div class="dashboard-loading-state">Loading your recent lectures...</div>';
  }

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      localStorage.removeItem(key);
      return fallback;
    }
  }

  let activeLecture = readJson('studyflow:activeLecture', null);
  const staleDemoLecture = activeLecture && /wavefunction collapse/i.test(activeLecture.title || '');
  if (activeLecture && (!activeLecture.youtubeId || staleDemoLecture)) {
    localStorage.removeItem('studyflow:activeLecture');
    activeLecture = null;
  }

  const SAFE_DEMO_VIDEO_ID = 'M7lc1UVf-VE';
  const DEMO_LECTURE_IDS = new Set(['phy1', 'phy2', 'math1', 'math2', 'chem1', 'prog1']);

  function normalizeLecture(lecture) {
    if (!lecture) return lecture;
    const normalized = { ...lecture };
    if (DEMO_LECTURE_IDS.has(normalized.id) || String(normalized.id || '').startsWith('fb-')) {
      normalized.youtubeId = SAFE_DEMO_VIDEO_ID;
    }
    return normalized;
  }

  activeLecture = normalizeLecture(activeLecture);
  
  // Set up YouTube player state
  let ytPlayer = null;
  let isYouTube = activeLecture && activeLecture.youtubeId;
  let youtubeCurrentTime = 0;
  let youtubePollTimer = null;
  let progressSaveTimer = null;

  function playbackProgressKey() {
    if (!activeLecture) return null;
    const sid = activeLecture.subjectId || getCurrentSubjectId() || 'global';
    return `studyflow:progress:${sid}:${getActiveVideoId()}`;
  }

  function getSavedPlaybackTime() {
    const key = playbackProgressKey();
    if (!key) return 0;
    try {
      const saved = JSON.parse(localStorage.getItem(key) || '{}');
      const time = Number(saved.time || 0);
      return Number.isFinite(time) ? Math.max(0, time) : 0;
    } catch (_) {
      localStorage.removeItem(key);
      return 0;
    }
  }

  function savePlaybackProgress(time = getCurrentPlaybackTime()) {
    const key = playbackProgressKey();
    const t = Math.floor(Number(time) || 0);
    if (!key || t < 3) return;
    localStorage.setItem(key, JSON.stringify({ time: t, updatedAt: Date.now() }));
  }

  function clearPlaybackProgress() {
    const key = playbackProgressKey();
    if (key) localStorage.removeItem(key);
  }

  function startProgressSaving() {
    clearInterval(progressSaveTimer);
    progressSaveTimer = setInterval(() => savePlaybackProgress(), 3000);
  }

  function getCurrentPlaybackTime() {
    if (ytPlayer && typeof ytPlayer.getCurrentTime === 'function') {
      const t = Number(ytPlayer.getCurrentTime());
      if (Number.isFinite(t)) {
        youtubeCurrentTime = t;
        return t;
      }
    }
    if (video && !isYouTube) {
      const t = Number(video.currentTime || 0);
      return Number.isFinite(t) ? t : 0;
    }
    return youtubeCurrentTime || 0;
  }

  function loadYouTubeApi() {
    return new Promise(resolve => {
      if (window.YT && window.YT.Player) return resolve();
      const previousReady = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof previousReady === 'function') previousReady();
        resolve();
      };
      if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(tag);
      }
    });
  }

  function startYouTubeTimeTracking(playerElementId) {
    loadYouTubeApi().then(() => {
      ytPlayer = new YT.Player(playerElementId, {
        events: {
          onReady: () => {
            const resumeAt = getSavedPlaybackTime();
            if (resumeAt > 3 && typeof ytPlayer.seekTo === 'function') {
              youtubeCurrentTime = resumeAt;
              ytPlayer.seekTo(resumeAt, true);
            }
            // Apply saved playback speed
            const savedSpeed = getDefaultPlaybackSpeed();
            if (savedSpeed !== 1 && typeof ytPlayer.setPlaybackRate === 'function') {
              ytPlayer.setPlaybackRate(savedSpeed);
            }
            clearInterval(youtubePollTimer);
            youtubePollTimer = setInterval(() => {
              getCurrentPlaybackTime();
            }, 500);
            startProgressSaving();
          },
          onStateChange: event => {
            getCurrentPlaybackTime();
            if (event.data === YT.PlayerState.ENDED) {
              clearPlaybackProgress();
              // Auto-generate summary if enabled in settings
              const settings = loadSettings();
              if (settings.autoSummary !== false) {
                generateSummary();
              }
              triggerNextLectureTransition();
            }
          }
        }
      });
    });
  }

  function renderActiveLectureView() {
    const videoWrapper = document.querySelector('.video-wrapper');
    if (activeLecture) {
      const subjectLabel = activeLecture.subjectName || activeLecture.subjectId || 'StudyFlow';
      const detailHeader = document.querySelector('.video-details h1');
      if (detailHeader) detailHeader.textContent = activeLecture.title;
      const detailMeta = document.getElementById('videoMetaLine');
      if (detailMeta) {
        detailMeta.textContent = `${subjectLabel} lecture - Duration: ${activeLecture.duration || '--:--'}`;
      }
      const metaTag = document.querySelector('.video-meta-tags span:nth-of-type(2)');
      if (metaTag) metaTag.textContent = activeLecture.title;
      const activeBadge = document.querySelector('.video-meta-tags span:first-of-type');
      if (activeBadge) activeBadge.textContent = subjectLabel;
    } else {
      if (window.location.pathname.includes('video.html')) {
        document.title = 'StudyFlow | Watch & Notes';
      }
      const detailHeader = document.querySelector('.video-details h1');
      if (detailHeader) detailHeader.textContent = 'Select a lecture to start watching';
      const detailMeta = document.getElementById('videoMetaLine');
      if (detailMeta) detailMeta.textContent = 'No lecture selected';
      const metaTag = document.querySelector('.video-meta-tags span:nth-of-type(2)');
      if (metaTag) metaTag.textContent = 'Select a lecture';
      const activeBadge = document.querySelector('.video-meta-tags span:first-of-type');
      if (activeBadge) activeBadge.textContent = 'StudyFlow';
      if (videoWrapper) {
        videoWrapper.innerHTML = `
          <div class="empty-video-state">
            <i data-lucide="video-off"></i>
            <span>Select a lecture from the Course Playlist</span>
          </div>
        `;
      }
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    if (!isYouTube) return;
    if (videoWrapper) {
      const controlsOverlay = document.querySelector('.video-controls-overlay');
      if (controlsOverlay) {
        controlsOverlay.style.display = 'none';
      }

      const rawVideoId = activeLecture.youtubeId;
      const videoId = encodeURIComponent(rawVideoId);
      const embedOrigin = encodeURIComponent(window.location.origin);
      const title = escapeHtml(activeLecture.title || 'YouTube lecture');
      const resumeAt = getSavedPlaybackTime();
      const resumeLabel = resumeAt > 3 ? formatTime(resumeAt) : '';
      videoWrapper.innerHTML = `
        <div class="youtube-player-shell">
          <button class="youtube-poster-button" type="button" aria-label="Play ${title}">
            <img src="https://img.youtube.com/vi/${videoId}/hqdefault.jpg" alt="${title}" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'320\' height=\'180\'><rect width=\'100%\' height=\'100%\' fill=\'%231f2937\'/><text x=\'50%\' y=\'50%\' fill=\'%239ca3af\' font-family=\'sans-serif\' font-size=\'14\' text-anchor=\'middle\' dy=\'.3em\'>No Thumbnail</text></svg>'">
            <span class="youtube-play-button"><i data-lucide="play" fill="currentColor"></i></span>
            ${resumeLabel ? `<span class="youtube-resume-badge">Resume ${resumeLabel}</span>` : ''}
          </button>
        </div>
      `;
      const posterButton = videoWrapper.querySelector('.youtube-poster-button');
      posterButton?.addEventListener('click', () => {
        const startParam = resumeAt > 3 ? `&start=${Math.floor(resumeAt)}` : '';
        videoWrapper.innerHTML = `
          <div class="youtube-player-shell">
            <iframe
              id="youtubePlayer"
              title="${title}"
              src="https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&playsinline=1&controls=1&rel=0&modestbranding=1&iv_load_policy=3&enablejsapi=1&origin=${embedOrigin}${startParam}"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowfullscreen
              referrerpolicy="strict-origin-when-cross-origin"></iframe>
          </div>
        `;
        startYouTubeTimeTracking('youtubePlayer');
      });
      if (window.lucide) window.lucide.createIcons();
    }
  }

  const videoMock = {
    get currentTime() {
      return getCurrentPlaybackTime();
    },
    set currentTime(val) {
      if (ytPlayer && typeof ytPlayer.seekTo === 'function') {
        youtubeCurrentTime = Number(val) || 0;
        ytPlayer.seekTo(val, true);
      }
    },
    play() {
      if (ytPlayer && typeof ytPlayer.playVideo === 'function') {
        ytPlayer.playVideo();
      }
    },
    get playbackRate() {
      return ytPlayer && typeof ytPlayer.getPlaybackRate === 'function' ? ytPlayer.getPlaybackRate() : 1;
    },
    set playbackRate(val) {
      if (ytPlayer && typeof ytPlayer.setPlaybackRate === 'function') {
        ytPlayer.setPlaybackRate(val);
      }
    },
    addEventListener(event, callback) {
      // Stub
    }
  };

  let video = isYouTube ? videoMock : document.getElementById('player');

  function seekToPlaybackTime(time) {
    const t = Number(time) || 0;
    if (isYouTube) {
      youtubeCurrentTime = t;
      if (ytPlayer && typeof ytPlayer.seekTo === 'function') {
        ytPlayer.seekTo(t, true);
        if (typeof ytPlayer.playVideo === 'function') ytPlayer.playVideo();
      }
      return;
    }
    if (video) {
      video.currentTime = t;
      if (typeof video.play === 'function') video.play();
    }
  }
  
  if (!isYouTube && video && typeof video.addEventListener === 'function') {
    video.addEventListener('loadedmetadata', () => {
      const resumeAt = getSavedPlaybackTime();
      if (resumeAt > 3 && resumeAt < Number(video.duration || Infinity)) {
        video.currentTime = resumeAt;
      }
      startProgressSaving();
    });
    video.addEventListener('timeupdate', () => savePlaybackProgress());
    video.addEventListener('ended', () => {
      clearPlaybackProgress();
      triggerNextLectureTransition();
    });
  }

  window.addEventListener('beforeunload', () => savePlaybackProgress());

  const addNoteBtn = document.getElementById('addNoteBtn');
  const noteText = document.getElementById('noteText');
  const notesListEl = document.getElementById('notesList');
  const searchNotes = document.getElementById('searchNotes');
  const bookmarkBtn = document.getElementById('bookmarkBtn');
  const genSummary = document.getElementById('genSummary');
  const genFlashcards = document.getElementById('genFlashcards');
  const genQuiz = document.getElementById('genQuiz');
  const explainSimply = document.getElementById('explainSimply');
  const aiModal = document.getElementById('aiModal');
  const aiModalBody = document.getElementById('aiModalBody');
  const closeAiModal = document.getElementById('closeAiModal');
    const bookmarksBtn = document.getElementById('bookmarksBtn');  const subjectSelect = document.getElementById('subjectSelect');

  function getActiveVideoId() {
    return activeLecture
      ? String(activeLecture.id || activeLecture.youtubeId || 'video1')
      : 'video1';
  }
  const SUBJECTS_KEY = 'studyflow:subjects';
  const CURRENT_SUBJECT_KEY = 'studyflow:currentSubject';
  let serverAvailable = false;

  async function checkServer(){
    try{
      const res = await fetch('/api/ping',{cache:'no-store'});
      if(res.ok) { serverAvailable = true; }
    }catch(e){ serverAvailable = false }
  }

  function loadLocalSubjects() {
    try{ return JSON.parse(localStorage.getItem(SUBJECTS_KEY)) || [] }catch(e){return []}
  }

  function mergeSubjects(remoteSubjects, localSubjects) {
    const byId = new Map();
    (remoteSubjects || []).forEach(s => {
      if (s?.id) byId.set(s.id, { id: s.id, name: s.name || s.id });
    });
    (localSubjects || []).forEach(s => {
      if (s?.id && !byId.has(s.id)) byId.set(s.id, { id: s.id, name: s.name || s.id });
    });
    return Array.from(byId.values());
  }

  async function loadSubjects(){
    const localSubjects = loadLocalSubjects();
    if(serverAvailable){
      try {
        const res = await fetch('/api/subjects', { cache: 'no-store' });
        if(res.ok) {
          const data = await res.json();
          const remoteSubjects = Array.isArray(data) ? data : [];
          const mergedSubjects = mergeSubjects(remoteSubjects, localSubjects);
          localStorage.setItem(SUBJECTS_KEY, JSON.stringify(mergedSubjects));
          if (localSubjects.length && mergedSubjects.length !== remoteSubjects.length) {
            saveSubjects(mergedSubjects).catch(() => {});
          }
          return mergedSubjects;
        }
      } catch(e) {}
    }
    return localSubjects;
  }
  async function saveSubjects(list){
    localStorage.setItem(SUBJECTS_KEY, JSON.stringify(list));
    // M4: Removed naive sync loop that spammed POST /api/subjects
  }
  function getCurrentSubjectId(){ return localStorage.getItem(CURRENT_SUBJECT_KEY) || null }
  function setCurrentSubjectId(id){ localStorage.setItem(CURRENT_SUBJECT_KEY, id); }

  const PROFILE_KEY = 'studyflow:profile';
  const SETTINGS_KEY = 'studyflow:settings';
  const DASHBOARD_VIEW_ALL_KEY = 'studyflow:dashboardViewAll';
  const DASHBOARD_PLAYED_KEY = 'studyflow:playedLectures';
  let dashboardShowAllLectures = localStorage.getItem(DASHBOARD_VIEW_ALL_KEY) === '1';
  function loadProfile() {
    try {
      return JSON.parse(localStorage.getItem(PROFILE_KEY)) || { name: 'Student', studySeconds: 0 };
    } catch(e) { return { name: 'Student', studySeconds: 0 }; }
  }
  function saveProfile(p) {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
    saveSetting('profile', p);
  }
  function localDateKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  function markStudyActivity(profile) {
    const p = profile || loadProfile();
    const days = Array.isArray(p.studyDays) ? p.studyDays : [];
    const today = localDateKey();
    if (!days.includes(today)) {
      days.push(today);
    }
    p.studyDays = days.slice(-90);
    return p;
  }
  function calculateStudyStreak(profile) {
    const days = new Set(Array.isArray(profile?.studyDays) ? profile.studyDays : []);
    let streak = 0;
    const cursor = new Date();
    while (days.has(localDateKey(cursor))) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }
  function loadSettings() {
    try {
      return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
    } catch(e) { return {}; }
  }
  function saveSettings(settings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  // ── Theme Application ──
  function applyTheme(themeValue) {
    const theme = themeValue || loadSettings().theme || 'dark';
    document.body.classList.remove('theme-light');
    if (theme === 'light') {
      document.body.classList.add('theme-light');
    } else if (theme === 'system') {
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
        document.body.classList.add('theme-light');
      }
    }
  }

  // ── Playback Speed Application ──
  function getDefaultPlaybackSpeed() {
    const s = loadSettings().playbackSpeed;
    const rate = parseFloat(s);
    return Number.isFinite(rate) && rate > 0 ? rate : 1;
  }
  function saveSetting(key, value) {
    const settings = loadSettings();
    settings[key] = value;
    saveSettings(settings);
    if (serverAvailable) {
      fetch(`/api/settings/${encodeURIComponent(key)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value })
      }).catch(() => {});
    }
  }
  async function hydrateSettingsFromServer() {
    if (!serverAvailable) return;
    try {
      const res = await fetch('/api/settings', { cache: 'no-store' });
      if (!res.ok) return;
      const remote = await res.json();
      if (remote && typeof remote === 'object') {
        saveSettings({ ...loadSettings(), ...remote });
        if (remote.profile && typeof remote.profile === 'object') {
          localStorage.setItem(PROFILE_KEY, JSON.stringify(remote.profile));
        }
      }
    } catch(e) {}
  }

  function loadPlayedLectures() {
    try {
      return JSON.parse(localStorage.getItem(DASHBOARD_PLAYED_KEY)) || [];
    } catch (e) {
      return [];
    }
  }

  function lectureHistoryKey(lecture) {
    if (!lecture?.subjectId) return null;
    const lectureId = lecture.youtubeId || lecture.id;
    if (!lectureId) return null;
    return `${lecture.subjectId}:${lectureId}`;
  }

  function dedupePlayedLectures(lectures) {
    const seen = new Set();
    return (lectures || []).filter(lecture => {
      const key = lectureHistoryKey(lecture);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function recordPlayedLecture(lecture) {
    if (!lecture || !lecture.id || !lecture.subjectId) return;
    const entry = {
      subjectId: lecture.subjectId,
      id: lecture.id,
      title: lecture.title,
      youtubeId: lecture.youtubeId,
      duration: lecture.duration
    };
    const entryKey = lectureHistoryKey(entry);
    const played = loadPlayedLectures().filter(x => lectureHistoryKey(x) !== entryKey);
    played.unshift(entry);
    localStorage.setItem(DASHBOARD_PLAYED_KEY, JSON.stringify(dedupePlayedLectures(played).slice(0, 24)));
  }

  function cleanupSubjectReferences(sid, remainingSubjects = []) {
    if (!sid) return;
    try {
      localStorage.removeItem(LECTURES_KEY + sid);
      localStorage.removeItem(`studyflow:emoji:${sid}`);

      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (
          key === `studyflow:notes:${sid}` ||
          key === `studyflow:bookmarks:${sid}` ||
          key?.startsWith(`studyflow:notes:${sid}:`) ||
          key?.startsWith(`studyflow:bookmarks:${sid}:`)
        ) {
          localStorage.removeItem(key);
        }
      }

      const played = loadPlayedLectures().filter(x => x.subjectId !== sid);
      localStorage.setItem(DASHBOARD_PLAYED_KEY, JSON.stringify(played));

      const current = localStorage.getItem(CURRENT_SUBJECT_KEY);
      if (current === sid) {
        if (remainingSubjects.length) {
          localStorage.setItem(CURRENT_SUBJECT_KEY, remainingSubjects[0].id);
        } else {
          localStorage.removeItem(CURRENT_SUBJECT_KEY);
        }
      }

      const active = readJson('studyflow:activeLecture', null);
      if (active?.subjectId === sid) {
        localStorage.removeItem('studyflow:activeLecture');
      }
    } catch (_) {}
  }

  function clearActiveLectureState() {
    localStorage.removeItem('studyflow:activeLecture');
    activeLecture = null;
    isYouTube = false;
    ytPlayer = null;
    youtubeCurrentTime = 0;
  }

  async function activateFirstLectureForSubject(sid) {
    if (!sid) return false;
    const lectures = (await loadLectures(sid)).filter(l => l && l.youtubeId);
    if (lectures.length === 0) return false;

    const first = lectures[0];
    activeLecture = normalizeLecture({
      subjectId: sid,
      id: first.id,
      title: first.title,
      youtubeId: first.youtubeId,
      duration: first.duration
    });
    localStorage.setItem('studyflow:activeLecture', JSON.stringify(activeLecture));
    isYouTube = Boolean(activeLecture.youtubeId);
    return true;
  }

  async function reconcileWatchLectureState(subjects) {
    const onWatchPage = Boolean(document.querySelector('.video-wrapper') || subjectSelect);
    if (!onWatchPage) return;

    const validIds = new Set(subjects.map(s => s.id));
    let current = getCurrentSubjectId();

    if (current && !validIds.has(current)) {
      localStorage.removeItem(CURRENT_SUBJECT_KEY);
      current = null;
    }

    if (activeLecture?.subjectId && !validIds.has(activeLecture.subjectId)) {
      clearActiveLectureState();
    }

    if (!current && activeLecture?.subjectId && validIds.has(activeLecture.subjectId)) {
      current = activeLecture.subjectId;
      setCurrentSubjectId(current);
    }

    if (!current && subjects.length) {
      current = subjects[0].id;
      setCurrentSubjectId(current);
    }

    if (activeLecture && current && activeLecture.subjectId !== current) {
      clearActiveLectureState();
    }

    if (activeLecture) {
      const lectures = await loadLectures(activeLecture.subjectId);
      const stillExists = lectures.some(l =>
        (activeLecture.id && l.id === activeLecture.id) ||
        (activeLecture.youtubeId && l.youtubeId === activeLecture.youtubeId)
      );
      if (!stillExists) {
        clearActiveLectureState();
      }
    }

    if (!activeLecture && current) {
      await activateFirstLectureForSubject(current);
    }

    isYouTube = Boolean(activeLecture?.youtubeId);
    video = isYouTube ? videoMock : document.getElementById('player');
  }

  function notesKey(){ const sid = getCurrentSubjectId() || 'global'; return `studyflow:notes:${sid}:${getActiveVideoId()}` }
  function bookmarksKey(){ const sid = getCurrentSubjectId() || 'global'; return `studyflow:bookmarks:${sid}:${getActiveVideoId()}` }

  async function loadNotes(){
    let localNotes = [];
    try{ localNotes = JSON.parse(localStorage.getItem(notesKey())) || [] }catch(e){ localNotes = [] }
    if(serverAvailable){
      try {
        const sid = getCurrentSubjectId();
        const res = await fetch(`/api/subjects/${sid}/notes?videoId=${encodeURIComponent(getActiveVideoId())}`);
        if(res.ok) {
          const remoteNotes = await res.json();
          if (remoteNotes.length > 0) {
            localStorage.setItem(notesKey(), JSON.stringify(remoteNotes));
            return remoteNotes;
          }
          return localNotes;
        }
      } catch(e) {}
    }
    return localNotes;
  }
  async function saveNotes(notes){
    if(serverAvailable){
      // Not used: notes are created individually via POST
      localStorage.setItem(notesKey(), JSON.stringify(notes));
      return;
    }
    localStorage.setItem(notesKey(), JSON.stringify(notes));
  }

  async function loadBookmarks(){
    let localBookmarks = [];
    try{ localBookmarks = JSON.parse(localStorage.getItem(bookmarksKey())) || [] }catch(e){ localBookmarks = [] }
    if(serverAvailable){
      try {
        const sid = getCurrentSubjectId();
        const res = await fetch(`/api/subjects/${sid}/bookmarks?videoId=${encodeURIComponent(getActiveVideoId())}`);
        if(res.ok) {
          const remoteBookmarks = await res.json();
          if (remoteBookmarks.length > 0) {
            localStorage.setItem(bookmarksKey(), JSON.stringify(remoteBookmarks));
            return remoteBookmarks;
          }
          return localBookmarks;
        }
      } catch(e) {}
    }
    return localBookmarks;
  }
  async function saveBookmarks(b){
    if(serverAvailable){
      // bookmarks created individually via POST
      localStorage.setItem(bookmarksKey(), JSON.stringify(b));
      return;
    }
    localStorage.setItem(bookmarksKey(), JSON.stringify(b));
  }

  async function deleteBookmark(id) {
    if (serverAvailable && id != null) {
      await fetch(`/api/bookmarks/${encodeURIComponent(id)}`, { method: 'DELETE' });
    }
    const bookmarks = await loadBookmarks();
    const updated = bookmarks.filter(x => String(x.id) !== String(id));
    localStorage.setItem(bookmarksKey(), JSON.stringify(updated));
    return updated;
  }

  function formatTime(s){
    s = Math.floor(s);
    const m = Math.floor(s/60).toString().padStart(2,'0');
    const sec = (s%60).toString().padStart(2,'0');
    return `${m}:${sec}`;
  }

  function renderMarkdown(text){
    if(!text) return '';
    // very small markdown: headings, bold, italic, code
    let out = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    out = out.replace(/^### (.*$)/gim,'<h3>$1</h3>');
    out = out.replace(/^## (.*$)/gim,'<h2>$1</h2>');
    out = out.replace(/^# (.*$)/gim,'<h1>$1</h1>');
    out = out.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>');
    out = out.replace(/\*(.*?)\*/g,'<em>$1</em>');
    out = out.replace(/`(.*?)`/g,'<code>$1</code>');
    out = out.replace(/\n/g,'<br/>');
    return out;
  }

  async function renderNotes(filter=''){
    // BUG FIX #3: Guard against null notesListEl (not on video page)
    if (!notesListEl) return;
    const raw = await loadNotes();
    const notes = (raw||[]).slice().sort((a,b)=>a.time-b.time);
    notesListEl.innerHTML='';
    const f = filter.trim().toLowerCase();
    
    if (notes.length === 0) {
      notesListEl.innerHTML = '<div style="color: var(--text-muted); font-size: 0.9rem; padding: 20px; text-align: center;">No notes taken yet. Type below to save your first note!</div>';
      return;
    }

    // BUG FIX #8: Differentiate no-notes from no-search-matches
    const matched = notes.filter(n => !f || n.text.toLowerCase().includes(f) || (n.tags||[]).join(' ').includes(f));
    if (matched.length === 0) {
      notesListEl.innerHTML = `<div style="color: var(--text-muted); font-size: 0.9rem; padding: 20px; text-align: center;">No notes match "${filter}"</div>`;
      return;
    }

    matched.forEach(n=>{
      
      const div = document.createElement('div');
      div.className = 'live-note';
      
      div.innerHTML = `
        <div class="live-note-header">
          <span class="live-note-time">${formatTime(n.time)}</span>
          <div class="live-note-actions">
            <button class="delete-note-btn" title="Delete Note" style="background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 4px; border-radius: 4px; display: flex; align-items: center; justify-content: center; transition: all 0.2s;">
              <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
            </button>
          </div>
        </div>
        <div class="live-note-content">
          ${renderMarkdown(n.text)}
        </div>
      `;

      // Event listeners are now handled via event delegation on notesListEl
      // to ensure they survive any DOM manipulation by lucide icons or other updates.
      div.dataset.noteId = n.id;
      div.dataset.noteTime = n.time;


      notesListEl.appendChild(div);
    });

    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  async function renderSidebarPlaylist() {
    const sidebarList = document.getElementById('lecturesTabContent');
    if (!sidebarList) return;
    
    let sid = getCurrentSubjectId() || activeLecture?.subjectId;
    let lectures = await loadLectures(sid);
    sidebarList.innerHTML = '';
    
    if (lectures.length === 0) {
      sidebarList.innerHTML = '<div style="color: var(--text-muted); font-size: 0.9rem; padding: 12px; text-align: center;">No lectures found. Go to Subjects workspace to import a playlist or video!</div>';
      return;
    }

    lectures.forEach(l => {
      const card = document.createElement('div');
      const isActive = activeLecture && l.youtubeId === activeLecture.youtubeId;
      
      card.style.display = 'flex';
      card.style.flexDirection = 'column';
      card.style.padding = '12px';
      card.style.marginBottom = '8px';
      card.style.borderRadius = 'var(--radius-md)';
      card.style.border = isActive ? '1px solid rgba(59, 130, 246, 0.4)' : '1px solid var(--glass-border)';
      card.style.background = isActive ? 'rgba(59, 130, 246, 0.05)' : 'rgba(255, 255, 255, 0.01)';
      card.style.cursor = 'pointer';
      card.style.transition = 'all 0.2s';
      
      card.innerHTML = `
        <div style="display: flex; align-items: flex-start; gap: 10px;">
          <div style="background: ${isActive ? 'var(--accent-blue)' : 'rgba(255,255,255,0.05)'}; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
            <i data-lucide="${isActive ? 'play' : 'video'}" style="width: 14px; height: 14px; color: ${isActive ? 'white' : 'var(--text-muted)'};"></i>
          </div>
          <div style="flex: 1;">
            <span style="font-weight: 500; font-size: 0.9rem; display: block; color: ${isActive ? 'white' : '#d1d5db'};">${l.title}</span>
            <span style="font-size: 0.75rem; color: var(--text-muted); font-family: monospace;">Duration: ${l.duration}</span>
          </div>
        </div>
      `;
      
      card.addEventListener('mouseenter', () => {
        card.style.background = isActive ? 'rgba(59, 130, 246, 0.08)' : 'rgba(255, 255, 255, 0.04)';
      });
      card.addEventListener('mouseleave', () => {
        card.style.background = isActive ? 'rgba(59, 130, 246, 0.05)' : 'rgba(255, 255, 255, 0.01)';
      });
      
      card.addEventListener('click', () => {
        const lecture = {
          subjectId: sid,
          id: l.id,
          title: l.title,
          youtubeId: l.youtubeId,
          duration: l.duration
        };
        localStorage.setItem('studyflow:activeLecture', JSON.stringify(lecture));
        localStorage.setItem('studyflow:currentSubject', sid);
        recordPlayedLecture(lecture);
        window.location.reload();
      });
      
      sidebarList.appendChild(card);
    });
    
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  async function triggerNextLectureTransition() {
    if (!activeLecture) return;
    const sid = activeLecture.subjectId;
    const lectures = await loadLectures(sid);
    const curIdx = lectures.findIndex(l => l.youtubeId === activeLecture.youtubeId);
    if (curIdx === -1 || curIdx >= lectures.length - 1) {
      return;
    }
    const nextLecture = lectures[curIdx + 1];
    
    const videoWrapper = document.querySelector('.video-wrapper');
    if (!videoWrapper) return;
    
    const overlay = document.createElement('div');
    overlay.id = 'autoplay-overlay';
    overlay.style.position = 'absolute';
    overlay.style.inset = '0';
    overlay.style.background = 'rgba(5, 7, 14, 0.92)';
    overlay.style.backdropFilter = 'blur(10px)';
    overlay.style.display = 'flex';
    overlay.style.flexDirection = 'column';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.color = 'white';
    overlay.style.zIndex = '100';
    overlay.style.padding = '24px';
    overlay.style.textAlign = 'center';
    
    let countdown = 5;
    
    overlay.innerHTML = `
      <div style="max-width: 400px; animation: fadeInUp 0.4s ease;">
        <div style="background: rgba(59,130,246,0.1); width: 64px; height: 64px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; border: 1px solid var(--accent-blue);">
          <i data-lucide="play-circle" style="width: 32px; height: 32px; color: var(--accent-blue);"></i>
        </div>
        <h2 style="font-size: 1.5rem; font-weight: 700; margin-bottom: 8px; font-family: 'Outfit', sans-serif;">Lecture Completed!</h2>
        <p style="color: var(--text-muted); font-size: 0.95rem; margin-bottom: 24px;">Up Next: <strong style="color: white;">${nextLecture.title}</strong></p>
        
        <div style="display: flex; gap: 12px; justify-content: center; align-items: center; margin-bottom: 20px;">
          <button id="autoplayCancelBtn" class="btn" style="background: rgba(255,255,255,0.05); color: white; border: 1px solid var(--glass-border); padding: 8px 16px; font-size: 0.9rem;">Cancel</button>
          <button id="autoplayNowBtn" class="btn btn-primary" style="padding: 8px 20px; font-size: 0.9rem; display: flex; align-items: center; gap: 8px;">
            Play Now (<span id="autoplayTimer">${countdown}</span>s)
          </button>
        </div>
      </div>
    `;
    
    videoWrapper.appendChild(overlay);
    if (window.lucide) window.lucide.createIcons();
    
    const intervalId = setInterval(() => {
      countdown--;
      const timerSpan = document.getElementById('autoplayTimer');
      if (timerSpan) {
        timerSpan.textContent = countdown;
      }
      if (countdown <= 0) {
        clearInterval(intervalId);
        playNext();
      }
    }, 1000);
    
    function playNext() {
      clearInterval(intervalId);
      localStorage.setItem('studyflow:activeLecture', JSON.stringify({
        subjectId: sid,
        id: nextLecture.id,
        title: nextLecture.title,
        youtubeId: nextLecture.youtubeId,
        duration: nextLecture.duration
      }));
      recordPlayedLecture({
        subjectId: sid,
        id: nextLecture.id,
        title: nextLecture.title,
        youtubeId: nextLecture.youtubeId,
        duration: nextLecture.duration
      });
      window.location.reload();
    }
    
    document.getElementById('autoplayNowBtn')?.addEventListener('click', playNext);
    document.getElementById('autoplayCancelBtn')?.addEventListener('click', () => {
      clearInterval(intervalId);
      overlay.remove();
    });
  }

  // Subjects UI helpers
  async function renderSubjectSelect(){
    if(!subjectSelect) return;
    const subs = await loadSubjects();
    subjectSelect.innerHTML='';
    subs.forEach(s=>{
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.name;
      subjectSelect.appendChild(opt);
    });
    const cur = getCurrentSubjectId();
    subjectSelect.value = cur;
    
    // BUG FIX #4: Use onchange (not addEventListener) to prevent multiple listeners
    // stacking up on repeated renderSubjectSelect() calls
    subjectSelect.onchange = async (e) => {
      const newSid = e.target.value;
      setCurrentSubjectId(newSid);
      const lectures = (await loadLectures(newSid)).filter(l => l && l.youtubeId);
      if (lectures.length > 0) {
        const firstL = lectures[0];
        localStorage.setItem('studyflow:activeLecture', JSON.stringify({
          subjectId: newSid,
          id: firstL.id,
          title: firstL.title,
          youtubeId: firstL.youtubeId,
          duration: firstL.duration
        }));
        recordPlayedLecture({
          subjectId: newSid,
          id: firstL.id,
          title: firstL.title,
          youtubeId: firstL.youtubeId,
          duration: firstL.duration
        });
      } else {
        localStorage.removeItem('studyflow:activeLecture');
        const played = loadPlayedLectures().filter(x => x.subjectId !== newSid);
        localStorage.setItem(DASHBOARD_PLAYED_KEY, JSON.stringify(played));
      }
      window.location.reload();
    };
  }

  /* ──────────────────────────────────────────
   *  SUBJECTS PAGE — Two-panel UI
   * ─────────────────────────────────────────*/

  // Colors for auto-assigning subject icons
  const SUBJECT_COLORS = [
    { bg: 'rgba(59,130,246,0.15)',  border: 'rgba(59,130,246,0.3)',  text: '#60a5fa' },
    { bg: 'rgba(139,92,246,0.15)', border: 'rgba(139,92,246,0.3)',  text: '#a78bfa' },
    { bg: 'rgba(16,185,129,0.15)', border: 'rgba(16,185,129,0.3)',  text: '#34d399' },
    { bg: 'rgba(245,158,11,0.15)', border: 'rgba(245,158,11,0.3)',  text: '#fbbf24' },
    { bg: 'rgba(236,72,153,0.15)', border: 'rgba(236,72,153,0.3)',  text: '#f472b6' },
    { bg: 'rgba(6,182,212,0.15)',  border: 'rgba(6,182,212,0.3)',   text: '#22d3ee' },
  ];
  function subjectColor(idx) { return SUBJECT_COLORS[idx % SUBJECT_COLORS.length]; }

  let _activeSubjectId = getCurrentSubjectId();

  async function renderSubjectsList() {
    const panel = document.getElementById('subjectItems');
    if (!panel) return;

    const subs = await loadSubjects();
    panel.innerHTML = '';

    if (subs.length === 0) {
      panel.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:0.85rem;">No subjects yet.<br>Click + to create one.</div>';
      return;
    }

    for (let i = 0; i < subs.length; i++) {
      const s = subs[i];
      const col = subjectColor(i);
      const lecs = readJson('studyflow:lectures:' + s.id, []);
      const isActive = s.id === _activeSubjectId;
      const emoji = localStorage.getItem(`studyflow:emoji:${s.id}`) || '\uD83D\uDCDA';

      const item = document.createElement('div');
      item.className = 'subject-item' + (isActive ? ' active' : '');
      // Store all data on the element — no closures needed
      item.dataset.sid = s.id;
      item.dataset.name = s.name;
      item.dataset.emoji = emoji;

      item.innerHTML = `
        <div class="subject-item-icon" style="background:${col.bg};border:1px solid ${col.border};">
          <span style="font-size:1rem;">${emoji}</span>
        </div>
        <div class="subject-item-info">
          <div class="subject-item-name">${s.name}</div>
          <div class="subject-item-count">${lecs.length} lecture${lecs.length !== 1 ? 's' : ''}</div>
        </div>
        <button class="subject-item-delete" data-delete-sid="${s.id}" data-name="${s.name}" title="Delete subject" style="background:none;border:none;color:#f87171;cursor:pointer;padding:4px 6px;border-radius:4px;opacity:0;transition:opacity 0.2s;flex-shrink:0;">
          ✕
        </button>
      `;

      // Show/hide delete on hover
      item.addEventListener('mouseenter', () => { item.querySelector('.subject-item-delete').style.opacity = '1'; });
      item.addEventListener('mouseleave', () => { item.querySelector('.subject-item-delete').style.opacity = '0'; });

      panel.appendChild(item);
    }

    // Auto-select active subject on load
    const activeSub = subs.find(s => s.id === _activeSubjectId) || subs[0];
    if (activeSub) {
      const emoji = localStorage.getItem(`studyflow:emoji:${activeSub.id}`) || '\uD83D\uDCDA';
      selectSubject(activeSub.id, activeSub.name, emoji);
    }
  }

  // Delegated subject panel click handler (attached once, survives re-renders)
  function initSubjectPanelDelegation() {
    const panel = document.getElementById('subjectItems');
    if (!panel || panel.dataset.delegated) return;
    panel.dataset.delegated = '1';

    panel.addEventListener('click', async (e) => {
      const deleteBtn = e.target.closest('[data-delete-sid]');
      if (deleteBtn) {
        e.stopPropagation();
        const sid = deleteBtn.dataset.deleteSid;
        const name = deleteBtn.dataset.name;
        if (!(await showConfirm(`Delete "${name}" and all its lectures?`))) return;
        if (serverAvailable) await fetch(`/api/subjects/${sid}`, { method: 'DELETE' });
        const remaining = (await loadSubjects()).filter(x => x.id !== sid);
        await saveSubjects(remaining);
        cleanupSubjectReferences(sid, remaining);
        if (_activeSubjectId === sid) {
          _activeSubjectId = remaining.length > 0 ? remaining[0].id : null;
          if (_activeSubjectId) setCurrentSubjectId(_activeSubjectId);
        }
        await renderSubjectsList();
        if (_activeSubjectId) {
          const sub = remaining.find(x => x.id === _activeSubjectId);
          if (sub) selectSubject(sub.id, sub.name, localStorage.getItem(`studyflow:emoji:${sub.id}`) || '\uD83D\uDCDA');
        } else { showNoSubjectState(); }
        return;
      }

      const card = e.target.closest('.subject-item');
      if (card) {
        const sid = card.dataset.sid;
        const name = card.dataset.name;
        const emoji = card.dataset.emoji;
        selectSubject(sid, name, emoji);
      }
    });
  }

  // Custom in-page confirm (no native dialog — works in all environments)
  function showConfirm(message) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(5,7,14,0.75);backdrop-filter:blur(6px);z-index:9999;display:flex;align-items:center;justify-content:center;';
      overlay.innerHTML = `
        <div style="background:#0e1117;border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:28px 32px;max-width:380px;width:90%;text-align:center;box-shadow:0 24px 60px rgba(0,0,0,0.6);">
          <div style="font-size:1.5rem;margin-bottom:12px;">⚠️</div>
          <p style="color:white;font-size:0.95rem;line-height:1.5;margin-bottom:24px;">${message}</p>
          <div style="display:flex;gap:10px;justify-content:center;">
            <button id="confirmCancel" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);color:#d1d5db;border-radius:10px;padding:9px 20px;cursor:pointer;font-size:0.875rem;font-family:inherit;">Cancel</button>
            <button id="confirmOk" style="background:#ef4444;border:none;color:white;border-radius:10px;padding:9px 20px;cursor:pointer;font-size:0.875rem;font-weight:600;font-family:inherit;">Delete</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      overlay.querySelector('#confirmOk').onclick = () => { overlay.remove(); resolve(true); };
      overlay.querySelector('#confirmCancel').onclick = () => { overlay.remove(); resolve(false); };
      overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); resolve(false); } });
    });
  }

  function showNoSubjectState() {
    const noState = document.getElementById('noSubjectState');
    const content = document.getElementById('subjectContent');
    if (noState) noState.style.display = 'flex';
    if (content) content.style.display = 'none';
  }

  async function selectSubject(sid, name, emoji) {
    _activeSubjectId = sid;
    setCurrentSubjectId(sid);

    // Update sidebar active state
    document.querySelectorAll('.subject-item').forEach(el => {
      el.classList.toggle('active', el.dataset.sid === sid);
    });

    // Show/hide panels
    const noState = document.getElementById('noSubjectState');
    const content = document.getElementById('subjectContent');
    if (noState) noState.style.display = 'none';
    if (content) { content.style.display = 'flex'; }

    // Load subject info
    const subs = await loadSubjects();
    const s = subs.find(x => x.id === sid);
    const resolvedName = name || (s ? s.name : sid);
    const resolvedEmoji = emoji || localStorage.getItem(`studyflow:emoji:${sid}`) || '📚';

    const nameEl = document.getElementById('activeSubjectName');
    const emojiEl = document.getElementById('activeSubjectEmoji');
    if (nameEl) nameEl.textContent = resolvedName;
    if (emojiEl) emojiEl.textContent = resolvedEmoji;

    // Render lectures for this subject
    await renderLecturesList();
  }

  function addNote(){
    return (async ()=>{
      const text = noteText ? noteText.value.trim() : '';
      if(!text) return showToast('Please write a note first!', 'error');
      const sid = getCurrentSubjectId();
      const payload = { videoId: getActiveVideoId(), time: Math.floor(getCurrentPlaybackTime()), text };
      const note = { id: Date.now(), time: payload.time, text };
      const notes = await loadNotes();
      if(serverAvailable){
        try {
          const res = await fetch(`/api/subjects/${sid}/notes`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
          if (res.ok) {
            const saved = await res.json();
            if (saved?.id != null) note.id = saved.id;
          }
        } catch(e) {
          console.warn('Could not sync note to server.', e);
        }
      }else{
        // Keep offline storage as the source of truth when no server is running.
      }
      notes.push(note);
      await saveNotes(notes);
      if(noteText) noteText.value='';
      await renderNotes(searchNotes ? searchNotes.value : '');
    })();
  }

  // Subject creation — works with new modal
  const createSubjectBtn = document.getElementById('createSubjectBtn');
  const newSubjectName = document.getElementById('newSubjectName');
  if (createSubjectBtn && newSubjectName) {
    // Allow Enter key
    newSubjectName.addEventListener('keydown', e => { if (e.key === 'Enter') createSubjectBtn.click(); });

    createSubjectBtn.addEventListener('click', async () => {
      const name = newSubjectName.value.trim();
      if (!name) { newSubjectName.focus(); return; }
      const id = 'subj_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 5);
      const subs = await loadSubjects();

      if (serverAvailable) {
        await fetch('/api/subjects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, name }) });
      } else {
        subs.push({ id, name });
        await saveSubjects(subs);
      }

      // Save chosen emoji
      const emoji = document.querySelector('.emoji-opt.selected')?.textContent || '📚';
      localStorage.setItem(`studyflow:emoji:${id}`, emoji);

      newSubjectName.value = '';
      if (typeof closeCreateModal === 'function') closeCreateModal();
      await renderSubjectsList();
      await renderSubjectSelect();
      // Auto-select the newly created subject
      selectSubject(id, name, emoji);
    });
  }

  function deleteNote(id){
    return (async ()=>{
      if(serverAvailable){ await fetch(`/api/notes/${id}`,{method:'DELETE'}); }
      let notes = await loadNotes(); 
      notes = notes.filter(n => String(n.id) !== String(id)); 
      await saveNotes(notes); 
      await renderNotes(searchNotes?searchNotes.value:'');
    })();
  }

  function addBookmark(){
    return (async ()=>{
      const sid = getCurrentSubjectId();
      const t = Math.floor(getCurrentPlaybackTime());
      const b = await loadBookmarks();
      const obj = { id: Date.now(), time: t };
      if(serverAvailable){
        try {
          const res = await fetch(`/api/subjects/${sid}/bookmarks`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({videoId:getActiveVideoId(),time:t})});
          if (res.ok) {
            const saved = await res.json();
            if (saved?.id != null) obj.id = saved.id;
          }
        } catch(e) {
          console.warn('Could not sync bookmark to server.', e);
        }
      }else{
        // Keep offline storage as the source of truth when no server is running.
      }
      b.push(obj);
      await saveBookmarks(b);
      showToast('Bookmarked at ' + formatTime(t));
    })();
  }

  const LECTURES_KEY = 'studyflow:lectures:';
  function loadLocalLectures(subjectId) {
    if (!subjectId) return [];
    try {
      const stored = localStorage.getItem(LECTURES_KEY + subjectId);
      return stored ? (JSON.parse(stored) || []).map(normalizeLecture) : [];
    } catch(e) {
      localStorage.removeItem(LECTURES_KEY + subjectId);
      return [];
    }
  }

  async function loadLectures(subjectId) {
    if (!subjectId) return [];
    const localLectures = loadLocalLectures(subjectId);
    if (serverAvailable) {
      try {
        const res = await fetch(`/api/subjects/${encodeURIComponent(subjectId)}/lectures`, { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          const remoteLectures = (Array.isArray(data) ? data : []).map(normalizeLecture);
          if (remoteLectures.length > 0) {
            localStorage.setItem(LECTURES_KEY + subjectId, JSON.stringify(remoteLectures));
            return remoteLectures;
          }
          if (localLectures.length > 0) {
            saveLectures(subjectId, localLectures).catch(() => {});
            return localLectures;
          }
          return [];
        }
      } catch(e) {}
    }

    if (localLectures.length > 0) return localLectures;
    return [];
  }

  async function saveLectures(subjectId, lectures) {
    if (!subjectId) return;
    const normalizedLectures = (lectures || []).map(normalizeLecture);
    localStorage.setItem(LECTURES_KEY + subjectId, JSON.stringify(normalizedLectures));
    if (serverAvailable) {
      try {
        const res = await fetch(`/api/subjects/${encodeURIComponent(subjectId)}/lectures`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ lectures: normalizedLectures })
        });
        if (!res.ok) throw new Error('Server did not save lectures.');
      } catch(e) {
        console.warn('Could not sync lectures to server.', e);
      }
    }
  }

  async function renderLecturesList() {
    const listEl = document.getElementById('lecturesList');
    const countEl = document.getElementById('lectureCount');
    if (!listEl) return;

    const sid = _activeSubjectId || getCurrentSubjectId();
    const subs = await loadSubjects();
    const activeSub = subs.find(x => x.id === sid);
    const sName = activeSub ? activeSub.name : 'StudyFlow';

    const lectures = await loadLectures(sid);
    listEl.innerHTML = '';

    if (countEl) countEl.textContent = `${lectures.length} lecture${lectures.length !== 1 ? 's' : ''}`;

    if (lectures.length === 0) {
      listEl.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-muted);font-size:0.875rem;">No lectures yet.<br>Import a YouTube playlist or video above to get started!</div>';
      return;
    }

    lectures.forEach((l, idx) => {
      const row = document.createElement('div');
      row.className = 'lecture-row';
      // Store IDs as data attributes — no closures, survives DOM replacement
      row.dataset.lectureId = l.id;
      row.dataset.lectureSid = sid;
      row.dataset.lectureSubjectName = sName;
      row.dataset.lectureYtid = l.youtubeId || '';
      row.dataset.lectureTitle = l.title;
      row.dataset.lectureDuration = l.duration;

      row.innerHTML = `
        <div class="lecture-num">${idx + 1}</div>
        <div class="lecture-info">
          <span class="lecture-title">${l.title}</span>
          <span class="lecture-meta">Duration: ${l.duration}</span>
        </div>
        <button class="lecture-watch-btn" data-action="watch" title="Watch this lecture">
          &#9654; Watch
        </button>
        <button class="lecture-delete-btn" data-action="delete" title="Remove lecture">
          &#128465;
        </button>
      `;

      listEl.appendChild(row);
    });

    // Delegated handler on listEl (attached once per render is fine since innerHTML wipes old ones)
    listEl.addEventListener('click', async (e) => {
      const row = e.target.closest('.lecture-row');
      if (!row) return;

      const action = e.target.closest('[data-action]')?.dataset.action;
      const lSid   = row.dataset.lectureSid;
      const lSName = row.dataset.lectureSubjectName;
      const lId    = row.dataset.lectureId;
      const lTitle = row.dataset.lectureTitle;
      const lYtid  = row.dataset.lectureYtid;
      const lDur   = row.dataset.lectureDuration;

      if (action === 'watch') {
        localStorage.setItem('studyflow:activeLecture', JSON.stringify({
          subjectId: lSid, subjectName: lSName, id: lId, title: lTitle, youtubeId: lYtid, duration: lDur
        }));
        setCurrentSubjectId(lSid);
        window.location.href = 'video.html';
      } else if (action === 'delete') {
        if (!(await showConfirm(`Remove "${lTitle}"?`))) return;
        const all = await loadLectures(lSid);
        const updated = all.filter(x => x.id !== lId);
        await saveLectures(lSid, updated);
        await renderLecturesList();
      }
    });
  }

  function extractYouTubeImport(url) {
    const value = String(url || '').trim();
    if (/^[A-Za-z0-9_-]{11}$/.test(value)) return { type: 'video', videoId: value };

    let parsed;
    try {
      parsed = new URL(value);
    } catch(e) {
      return null;
    }

    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    if (host !== 'youtube.com' && host !== 'm.youtube.com' && host !== 'youtu.be') return null;
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    const playlistId = parsed.searchParams.get('list');
    const videoId =
      parsed.searchParams.get('v') ||
      (host === 'youtu.be' ? pathParts[0] : null) ||
      (['shorts', 'embed', 'live'].includes(pathParts[0]) ? pathParts[1] : null);

    if (videoId && /^[A-Za-z0-9_-]{11}$/.test(videoId)) return { type: 'video', videoId };
    if (playlistId) return { type: 'playlist', playlistId };
    return null;
  }

  async function fetchSingleVideoLecture(videoId) {
    try {
      const res = await fetch(`/api/youtube/video?videoId=${encodeURIComponent(videoId)}`, {
        cache: 'no-store'
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.lecture?.youtubeId) return data.lecture;
      }
    } catch(e) {
      console.warn('Server video metadata lookup failed.', e);
    }

    return {
      id: `yt-${videoId}-${Date.now()}-0`,
      title: `YouTube video ${videoId}`,
      youtubeId: videoId,
      duration: '--:--'
    };
  }

  // Reusable YouTube import logic
  async function handlePlaylistImport(url, sid, activeSubName, btnElement, statusElement, inputElement, onSuccessCallback) {
    if (!url) return showToast('Please enter a YouTube playlist or video URL!', 'error');

    const youtubeImport = extractYouTubeImport(url);
    if (!youtubeImport) {
      return alert('Invalid YouTube URL. Paste a playlist URL or a single video URL.');
    }
    
    function setStatus(msg, color) {
      if (statusElement) { 
        statusElement.style.display = 'block'; 
        statusElement.style.color = color || 'var(--text-muted)'; 
        statusElement.textContent = msg; 
        
        // Auto-hide success message after 4 seconds
        if (color !== 'var(--text-muted)') {
          setTimeout(() => {
            if (statusElement) statusElement.style.display = 'none';
          }, 4000);
        }
      }
    }
    
    // Show dynamic loading state
    const originalBtnHTML = btnElement ? btnElement.innerHTML : '';
    if (btnElement) {
      btnElement.disabled = true;
      btnElement.innerHTML = '<i data-lucide="loader"></i> Fetching...';
    }
    setStatus(youtubeImport.type === 'playlist' ? 'Fetching playlist videos...' : 'Fetching video...', 'var(--text-muted)');
    if (window.lucide) window.lucide.createIcons();

    try {
      let importedLectures = [];

      if (youtubeImport.type === 'video') {
        importedLectures = [await fetchSingleVideoLecture(youtubeImport.videoId)];
      } else {
        const playlistId = youtubeImport.playlistId;
        const serverResponse = await fetch(`/api/youtube/playlist?playlistId=${encodeURIComponent(playlistId)}`, {
          cache: 'no-store'
        });
        if (serverResponse.ok) {
          const data = await serverResponse.json();
          importedLectures = Array.isArray(data.lectures) ? data.lectures : [];
        }

        if (importedLectures.length === 0) {
      // Fetch playlist from YouTube's public RSS feed via our premium Dual CORS Proxy
      const targetUrl = 'https://www.youtube.com/feeds/videos.xml?playlist_id=' + playlistId;
      
      let feedText = null;
      
      // Proxy 1: corsproxy.io (Super fast, highly reliable)
      try {
        const response = await fetch('https://corsproxy.io/?' + encodeURIComponent(targetUrl));
        if (response.ok) {
          const text = await response.text();
          if (text && text.includes('<entry>')) {
            feedText = text;
          }
        }
      } catch (e) {
        console.warn('corsproxy.io failed, trying backup AllOrigins...', e);
      }
      
      // Proxy 2: AllOrigins (Backup CORS Proxy)
      if (!feedText) {
        const proxyUrl = 'https://api.allorigins.win/get?url=' + encodeURIComponent(targetUrl);
        const response = await fetch(proxyUrl);
        if (response.ok) {
          const data = await response.json();
          if (data && data.contents && data.contents.includes('<entry>')) {
            feedText = data.contents;
          }
        }
      }
      
      if (!feedText) {
        throw new Error('Both CORS proxies failed or returned empty content');
      }
      
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(feedText, "text/xml");
      const entries = xmlDoc.getElementsByTagName("entry");
      
      if (entries.length === 0) {
        throw new Error('No videos found in playlist feed');
      }
      
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const title = entry.getElementsByTagName("title")[0]?.textContent || `Lecture ${i+1}`;
        
        let ytId = "";
        const ytIdTags = entry.getElementsByTagName("yt:videoId");
        if (ytIdTags.length > 0) {
          ytId = ytIdTags[0].textContent;
        } else {
          const href = entry.getElementsByTagName("link")[0]?.getAttribute("href") || "";
          const vMatch = href.match(/[?&]v=([^&#]+)/);
          if (vMatch) ytId = vMatch[1];
        }

        if (ytId) {
          const min = Math.floor(Math.random() * 30) + 15;
          const sec = Math.floor(Math.random() * 59).toString().padStart(2, '0');
          const duration = `${min}:${sec}`;

          importedLectures.push({
            id: `yt-${ytId}-${Date.now()}-${i}`,
            title: title,
            youtubeId: ytId,
            duration: duration
          });
        }
      }
      }
      }

      if (importedLectures.length === 0) {
        throw new Error('Parsed 0 valid videos');
      }

      await saveLectures(sid, importedLectures);
      if (inputElement) inputElement.value = '';
      setStatus(
        importedLectures.length === 1
          ? 'Imported 1 YouTube video as a course lecture.'
          : `Imported ${importedLectures.length} lectures from YouTube.`,
        '#34d399'
      );
      if (onSuccessCallback) await onSuccessCallback();

    } catch (error) {
      console.warn('YouTube import failed.', error);
      setStatus('Could not import this YouTube URL. Check that it is public and try again.', '#f87171');
    } finally {
      if (btnElement) {
        btnElement.disabled = false;
        btnElement.innerHTML = originalBtnHTML;
      }
      if (window.lucide) window.lucide.createIcons();
    }
  }

  // YouTube import logic
  const importPlaylistBtn = document.getElementById('importPlaylistBtn');
  const playlistUrlInput = document.getElementById('playlistUrl');
  if (importPlaylistBtn && playlistUrlInput) {
    importPlaylistBtn.addEventListener('click', async () => {
      const url = playlistUrlInput.value.trim();
      const sid = _activeSubjectId || getCurrentSubjectId();
      const activeSubName = document.getElementById('activeSubjectName')?.textContent || document.getElementById('subjectTitle')?.textContent || 'this subject';
      const statusEl = document.getElementById('importStatus');
      await handlePlaylistImport(url, sid, activeSubName, importPlaylistBtn, statusEl, playlistUrlInput, renderLecturesList);
    });
  }

  function openAiModal(title, html){
    const titleEl = document.getElementById('aiModalTitle');
    if(titleEl) titleEl.textContent = title;
    if(aiModalBody) aiModalBody.innerHTML = html;
    if(aiModal) {
      // BUG FIX #5: use 'flex' not 'block' — modal uses flexbox to center
      aiModal.style.display = 'flex';
    }
  }

  function closeAi(){
    if(aiModal) aiModal.style.display = 'none';
  }

  async function callAI(systemPrompt, userPrompt) {
    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemPrompt,
          userPrompt
        })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      return data.text || null;
    } catch (e) {
      console.error("Gemini API Error:", e);
      return null;
    }
  }

  function formatNotesContext(notes) {
    if (!notes || notes.length === 0) return "Optional notes: none for this request.";
    return notes.map(n => `[${formatTime(n.time)}] ${n.text}`).join('\n');
  }

  async function buildStudyContext() {
    const notes = (await loadNotes()).sort((a,b)=>a.time-b.time);
    const lectureTitle = activeLecture?.title || document.querySelector('.video-details h1')?.textContent || 'Current lecture';
    const subject = activeLecture?.subjectId || getCurrentSubjectId() || 'current subject';
    const timestamp = formatTime(getCurrentPlaybackTime());
    const youtubeId = activeLecture?.youtubeId || '';
    const youtubeUrl = youtubeId ? `https://www.youtube.com/watch?v=${youtubeId}` : 'No YouTube URL available';
    return {
      notes,
      lectureTitle,
      subject,
      timestamp,
      youtubeId,
      youtubeUrl,
      notesContext: formatNotesContext(notes)
    };
  }

  function studySystemPrompt() {
    return [
      'You are StudyFlow AI, a concise study coach inside a lecture note-taking app.',
      'Use the current YouTube URL, lecture title, subject, and timestamp as the primary context.',
      'Treat saved notes as optional extra context only.',
      'Do not mention that notes are missing, do not apologize for missing notes, and do not tell the student to add notes unless they explicitly ask about note-taking.',
      'Prefer structured answers with short headings, bullets, examples, and concrete study actions.',
      'If you cannot access the video contents directly, answer from the title, URL, timestamp, subject, and user request without drawing attention to unavailable notes.'
    ].join(' ');
  }

  function studyUserPrompt(ctx, task) {
    return `Lecture: ${ctx.lectureTitle}
Subject: ${ctx.subject}
YouTube URL: ${ctx.youtubeUrl}
YouTube video id: ${ctx.youtubeId || 'none'}
Current timestamp: ${ctx.timestamp}

Optional saved notes:
${ctx.notesContext}

Student request:
${task}`;
  }

  function loadingHtml(label='Thinking...') {
    return `<div style="display:flex;align-items:center;gap:10px;justify-content:center;padding:34px;color:var(--text-muted);"><i data-lucide="loader" style="animation: spin 2s linear infinite;"></i><span>${label}</span></div>`;
  }

  async function runStudyAssistant(title, task) {
    const ctx = await buildStudyContext();
    openAiModal(title, loadingHtml());
    if (window.lucide) window.lucide.createIcons();
    const res = await callAI(studySystemPrompt(), studyUserPrompt(ctx, task)) || fallbackStudyAnswer(ctx, task);
    openAiModal(title, `<div style="line-height:1.6;">${renderMarkdown(res)}</div>`);
  }

  function fallbackStudyAnswer(ctx, task) {
    if (!ctx.notes.length) {
      return `I could not reach the AI service right now.

Lecture: ${ctx.lectureTitle}
YouTube URL: ${ctx.youtubeUrl}
Timestamp: ${ctx.timestamp}

Quick help from the current video:
1. Focus on the lecture topic: ${ctx.lectureTitle}
2. Ask about the idea being discussed around ${ctx.timestamp}.
3. Use the YouTube link above to continue the lesson, then ask for a summary, quiz, or explanation.

Request saved: ${task}`;
    }
    const latest = ctx.notes[ctx.notes.length - 1];
    return `I could not reach the AI service right now, so here is a quick study pass.

Lecture: ${ctx.lectureTitle}
YouTube URL: ${ctx.youtubeUrl}
Timestamp: ${ctx.timestamp}

Latest note:
${latest.text}

Quick actions:
1. Re-read notes at ${ctx.notes.slice(0, 3).map(n => formatTime(n.time)).join(', ')}
2. Turn the latest note into one question and one answer.
3. Add one clarification note for anything that still feels unclear.

Request saved: ${task}`;
  }

  function generateSummary(){
    return (async ()=>{
      await runStudyAssistant('Lecture Summary', 'Summarize this lecture from the current YouTube URL, title, subject, and timestamp. Include key ideas, likely focus areas, and 3 revision actions.');
    })();
  }

  function generateFlashcards(){
    return (async ()=>{
      const ctx = await buildStudyContext();
      openAiModal('Generating Flashcards...', loadingHtml());
      if (window.lucide) window.lucide.createIcons();
      const res = await callAI(studySystemPrompt(), studyUserPrompt(ctx, 'Create 5 flashcards for this lecture using the current YouTube URL, title, subject, timestamp, and optional notes. Format each exactly as Q: question and A: answer.'));
      const formattedHtml = escapeHtml(res).replace(/Q:/g, '<strong>Q:</strong>').replace(/A:/g, '<br/><strong>A:</strong>').split('\n\n').map(card => `<div style="padding:10px;border-radius:8px;background:rgba(255,255,255,0.02);margin-bottom:8px">${card}</div>`).join('');
      openAiModal('Flashcards', formattedHtml);
    })();
  }

  function generateQuiz(){
    return (async ()=>{
      await runStudyAssistant('Practice Quiz', 'Create a 5-question quiz for this lecture using the current YouTube URL, title, subject, timestamp, and optional notes. Mix multiple choice and short-answer. Put answers at the end.');
    })();
  }

  function explainSimple(){
    return (async ()=>{
      const ctx = await buildStudyContext();
      const last = ctx.notes[ctx.notes.length - 1];
      const task = last
        ? `Explain this latest note simply with an analogy and one example: ${last.text}`
        : 'Explain the current lecture topic simply using the YouTube URL, title, subject, and timestamp. Include one example and what to focus on next.';
      await runStudyAssistant('Explain Simply', task);
    })();
  }

  function simplifyText(s){ return s; }
  function escapeHtml(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br/>'); }

  // events
  if (notesListEl) {
    notesListEl.addEventListener('click', async (e) => {
      // Handle delete note
      const delBtn = e.target.closest('.delete-note-btn');
      if (delBtn) {
        e.stopPropagation();
        const liveNote = delBtn.closest('.live-note');
        if (liveNote && liveNote.dataset.noteId) {
          const id = liveNote.dataset.noteId;
          if (await showConfirm('Delete this note?')) {
            deleteNote(id);
          }
        }
        return;
      }

      // Handle time click
      const timeSpan = e.target.closest('.live-note-time');
      if (timeSpan) {
        const liveNote = timeSpan.closest('.live-note');
        if (liveNote && liveNote.dataset.noteTime) {
          seekToPlaybackTime(liveNote.dataset.noteTime);
        }
      }
    });
  }

  addNoteBtn && addNoteBtn.addEventListener('click',addNote);
  bookmarkBtn && bookmarkBtn.addEventListener('click',addBookmark);
  searchNotes && searchNotes.addEventListener('input',async e=>await renderNotes(e.target.value));
  genSummary && genSummary.addEventListener('click',generateSummary);
  genFlashcards && genFlashcards.addEventListener('click',generateFlashcards);
  genQuiz && genQuiz.addEventListener('click',generateQuiz);
  explainSimply && explainSimply.addEventListener('click',explainSimple);
  closeAiModal && closeAiModal.addEventListener('click',closeAi);

  // Custom AI Chat Logic
  const aiChatInput = document.getElementById('aiChatInput');
  const aiChatSend = document.getElementById('aiChatSend');
  const aiMessages = document.getElementById('aiMessages');

  if (aiMessages) {
    aiMessages.addEventListener('click', e => {
      const promptBtn = e.target.closest('[data-ai-prompt]');
      if (!promptBtn) return;
      runStudyAssistant(promptBtn.textContent.trim(), promptBtn.dataset.aiPrompt);
    });
  }

  if (aiChatSend && aiChatInput) {
    const handleChat = async () => {
      const q = aiChatInput.value.trim();
      if (!q) return;
      aiChatInput.value = '';
      aiChatSend.disabled = true;
      
      try {
        const ctx = await buildStudyContext();
        openAiModal('AI Chat', loadingHtml());
        if (window.lucide) window.lucide.createIcons();
        const res = await callAI(studySystemPrompt(), studyUserPrompt(ctx, q));
        openAiModal('AI Chat', `<div><strong>You asked:</strong><div style='margin-bottom:12px; color:var(--accent-blue);'>${escapeHtml(q)}</div><strong>Answer:</strong><div style='white-space:pre-wrap;line-height:1.6;'>${escapeHtml(res)}</div></div>`);
      } finally {
        aiChatSend.disabled = false;
      }
    };
    
    aiChatSend.addEventListener('click', handleChat);
    aiChatInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') handleChat();
    });
  }

  // floating note quick capture
  document.querySelectorAll('.floating-note').forEach(el=>el.addEventListener('click',()=>{
    const t = Math.floor(getCurrentPlaybackTime());
    if(noteText){ noteText.value = `[${formatTime(t)}] `; noteText.focus(); }
  }));

  // focus mode
  function renderBookmarksModal(bookmarks) {
    if (!bookmarks.length) {
      openAiModal('Bookmarks', '<div style="color:var(--text-muted);font-size:0.9rem;padding:14px 0;">No bookmarks yet.</div>');
      return;
    }
    const html = bookmarks.map(x => {
      const id = x.id ?? '';
      const time = Number(x.time) || 0;
      return `
        <div class="bookmark-row" style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border-radius:10px;background:rgba(255,255,255,0.035);border:1px solid var(--glass-border);margin-bottom:8px;">
          <button class="btn small bookmark-jump-btn" data-time="${time}" style="padding:6px 10px;font-size:0.82rem;">${formatTime(time)}</button>
          <button class="bookmark-delete-btn" data-id="${id}" title="Delete bookmark" style="width:30px;height:30px;display:flex;align-items:center;justify-content:center;border-radius:8px;border:1px solid rgba(239,68,68,0.25);background:rgba(239,68,68,0.1);color:#f87171;cursor:pointer;">
            <i data-lucide="trash-2" style="width:14px;height:14px;"></i>
          </button>
        </div>
      `;
    }).join('');
    openAiModal('Bookmarks', html);
    if (window.lucide) window.lucide.createIcons();
  }

  // bookmarks panel quick show
  bookmarksBtn && bookmarksBtn.addEventListener('click',()=>{
    (async ()=>{
      renderBookmarksModal(await loadBookmarks());
    })();
  });

  if (aiModalBody) {
    aiModalBody.addEventListener('click', async e => {
      const jumpBtn = e.target.closest('.bookmark-jump-btn');
      if (jumpBtn) {
        seekToPlaybackTime(jumpBtn.dataset.time);
        closeAi();
        return;
      }

      const deleteBtn = e.target.closest('.bookmark-delete-btn');
      if (!deleteBtn) return;
      if (!(await showConfirm('Delete this bookmark?'))) return;
      const updated = await deleteBookmark(deleteBtn.dataset.id);
      renderBookmarksModal(updated);
    });
  }
  async function renderSettingsSubjects() {
    const listEl = document.getElementById('settingsSubjectList');
    if (!listEl) return;
    
    const subs = await loadSubjects();
    listEl.innerHTML = '';
    
    if (subs.length === 0) {
      listEl.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;padding:8px 0;">No subjects added yet.</div>';
      return;
    }
    
    subs.forEach(s => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;background:rgba(255,255,255,0.03);padding:10px 14px;border-radius:var(--radius-sm);border:1px solid rgba(255,255,255,0.05);';
      row.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;min-width:180px;">
          <div style="display:flex;align-items:center;justify-content:center;width:36px;height:36px;background:rgba(255,255,255,0.05);border-radius:8px;border:1px solid var(--glass-border);color:var(--text-muted);">
            <i data-lucide="book-open" style="width:18px;height:18px;"></i>
          </div>
          <span style="color:white;font-size:0.95rem;font-weight:500;">${s.name}</span>
        </div>
        <div style="display:flex;gap:8px;flex:1;align-items:center;justify-content:flex-end;">
          <input type="text" class="settings-import-input" data-sid="${s.id}" placeholder="Paste YouTube playlist or video URL..." style="flex:1;max-width:280px;background:rgba(255,255,255,0.05);border:1px solid var(--glass-border);border-radius:var(--radius-sm);padding:6px 10px;color:white;font-size:0.8rem;outline:none;">
          <button class="btn btn-primary settings-import-btn" data-sid="${s.id}" style="padding:6px 12px;font-size:0.8rem;white-space:nowrap;display:flex;align-items:center;gap:4px;"><i data-lucide="download" style="width:14px;height:14px;"></i> Import</button>
          <div class="settings-import-status" data-sid="${s.id}" style="display:none;font-size:0.75rem;max-width:100px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"></div>
          <button class="settings-delete-subject" data-sid="${s.id}" data-name="${s.name}" title="Delete Subject" style="background:none;border:none;color:var(--text-muted);cursor:pointer;padding:6px;border-radius:4px;transition:all 0.2s;margin-left:8px;">
            <i data-lucide="trash-2" style="width:16px;height:16px;"></i>
          </button>
        </div>
      `;
      listEl.appendChild(row);
    });
    
    if (window.lucide) window.lucide.createIcons();
  }

  function initSettingsControls() {
    const profileNameInput = document.getElementById('profileNameInput');
    if (profileNameInput && !profileNameInput.dataset.bound) {
      profileNameInput.dataset.bound = '1';
      profileNameInput.value = loadProfile().name || '';
      profileNameInput.addEventListener('blur', (e) => {
        const p = loadProfile();
        p.name = e.target.value.trim() || 'Student';
        saveProfile(p);
        profileNameInput.value = p.name;
      });
    }

    const settings = loadSettings();
    const controls = [
      ['themePreference', 'theme'],
      ['playbackSpeedPreference', 'playbackSpeed'],
      ['streakTargetPreference', 'streakTarget']
    ];
    controls.forEach(([id, key]) => {
      const el = document.getElementById(id);
      if (!el || el.dataset.bound) return;
      el.dataset.bound = '1';
      if (settings[key]) el.value = settings[key];
      el.addEventListener('change', () => {
        saveSetting(key, el.value);
        // Live-apply theme changes
        if (key === 'theme') applyTheme(el.value);
      });
    });

    const toggles = [
      ['autoSummaryPreference', 'autoSummary'],
      ['smartSyncPreference', 'smartSync']
    ];
    toggles.forEach(([id, key]) => {
      const el = document.getElementById(id);
      if (!el || el.dataset.bound) return;
      el.dataset.bound = '1';
      if (typeof settings[key] === 'boolean') el.checked = settings[key];
      el.addEventListener('change', () => saveSetting(key, el.checked));
    });

    // ── H3: Reset Data button ──
    const resetBtn = document.getElementById('resetDataBtn');
    if (resetBtn && !resetBtn.dataset.bound) {
      resetBtn.dataset.bound = '1';
      resetBtn.addEventListener('click', async () => {
        if (!(await showConfirm('This will permanently delete ALL your study data — subjects, lectures, notes, bookmarks, streaks, and settings. This cannot be undone. Continue?'))) return;
        // Clear all studyflow localStorage keys
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith('studyflow:')) keysToRemove.push(key);
        }
        keysToRemove.forEach(k => localStorage.removeItem(k));
        // Clear server data
        if (serverAvailable) {
          try { await fetch('/api/reset', { method: 'DELETE' }); } catch (e) { console.warn('Server reset failed', e); }
        }
        window.location.reload();
      });
    }

    // ── H6: Settings search ──
    const settingsSearchInput = document.getElementById('settingsSearch');
    if (settingsSearchInput && !settingsSearchInput.dataset.bound) {
      settingsSearchInput.dataset.bound = '1';
      settingsSearchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim().toLowerCase();
        document.querySelectorAll('.setting-section').forEach(section => {
          if (!query) {
            section.style.display = '';
            return;
          }
          const text = section.textContent.toLowerCase();
          section.style.display = text.includes(query) ? '' : 'none';
        });
      });
    }
  }

  // Settings Add Subject Handler
  const settingsAddSubjectBtn = document.getElementById('settingsAddSubjectBtn');
  const settingsNewSubjectName = document.getElementById('settingsNewSubjectName');
  if (settingsAddSubjectBtn && settingsNewSubjectName) {
    settingsNewSubjectName.addEventListener('keydown', e => { if (e.key === 'Enter') settingsAddSubjectBtn.click(); });
    settingsAddSubjectBtn.addEventListener('click', async () => {
      const name = settingsNewSubjectName.value.trim();
      if (!name) return;
      
      const id = 'subj_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 5);
      const subs = await loadSubjects();

      settingsAddSubjectBtn.disabled = true;
      try {
        if (serverAvailable) {
          const res = await fetch('/api/subjects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, name }) });
          if (!res.ok) throw new Error('Server did not save the subject.');
        }

        const next = [...subs, { id, name }];
        localStorage.setItem(SUBJECTS_KEY, JSON.stringify(next));
        if (!serverAvailable) await saveSubjects(next);

        settingsNewSubjectName.value = '';
        await renderSettingsSubjects();
        await renderSubjectSelect();
        await renderSubjectsList();
      } catch (e) {
        showToast(e.message || 'Could not save subject. Please try again.', 'error');
      } finally {
        settingsAddSubjectBtn.disabled = false;
      }
    });
  }

  // Settings Delete Subject Handler (Delegated)
  const settingsSubjectList = document.getElementById('settingsSubjectList');
  if (settingsSubjectList) {
    settingsSubjectList.addEventListener('click', async (e) => {
      const deleteBtn = e.target.closest('.settings-delete-subject');
      if (deleteBtn) {
        const sid = deleteBtn.dataset.sid;
        const name = deleteBtn.dataset.name;
        if (!(await showConfirm(`Delete "${name}" and all its lectures?`))) return;
        
        if (serverAvailable) await fetch(`/api/subjects/${sid}`, { method: 'DELETE' });
        const remaining = (await loadSubjects()).filter(x => x.id !== sid);
        await saveSubjects(remaining);
        cleanupSubjectReferences(sid, remaining);
        
        if (_activeSubjectId === sid) {
          _activeSubjectId = remaining.length > 0 ? remaining[0].id : null;
          if (_activeSubjectId) setCurrentSubjectId(_activeSubjectId);
        }
        
        await renderSettingsSubjects();
        return;
      }
      
      const importBtn = e.target.closest('.settings-import-btn');
      if (importBtn) {
        const sid = importBtn.dataset.sid;
        const row = importBtn.closest('div[style*="display:flex"]');
        const inputEl = row.querySelector('.settings-import-input');
        const statusEl = row.querySelector('.settings-import-status');
        const url = inputEl.value.trim();
        await handlePlaylistImport(url, sid, sid, importBtn, statusEl, inputEl, null);
      }
    });
  }

  async function renderDashboard() {
    // 1. Render Welcome Name
    const welcomeName = document.getElementById('dashboardWelcomeName');
    if (welcomeName) {
      const p = loadProfile();
      welcomeName.innerHTML = `Welcome back, <span class="text-gradient">${escapeHtml(p.name || 'Student')}</span>`;
    }

    // 2. Render Study Hours
    const studyHoursEl = document.getElementById('dashboardStudyHours');
    if (studyHoursEl) {
      const p = loadProfile();
      const hours = ((p.studySeconds || 0) / 3600).toFixed(1);
      studyHoursEl.textContent = `${hours} hrs`;
    }

    const streakEl = document.getElementById('dashboardStudyStreak');
    if (streakEl) {
      const streak = calculateStudyStreak(loadProfile());
      streakEl.textContent = `${streak} ${streak === 1 ? 'Day' : 'Days'}`;
    }

    // 3. Render Recent Notes
    const recentNotesContainer = document.getElementById('dashboardRecentNotes');
    if (recentNotesContainer) {
      let allNotes = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('studyflow:notes:')) {
          try {
            const arr = JSON.parse(localStorage.getItem(key)) || [];
            allNotes.push(...arr);
          } catch(e) {}
        }
      }
      
      allNotes.sort((a, b) => Number(b.id) - Number(a.id)); // Newest first based on Date.now() id
      const topNotes = allNotes.slice(0, 3);
      
      if (topNotes.length === 0) {
        recentNotesContainer.innerHTML = '<div style="color: var(--text-muted); font-size: 0.9rem; text-align: center; padding: 20px 0;">No notes found. Start watching to add some!</div>';
      } else {
        recentNotesContainer.innerHTML = topNotes.map(n => `
          <div class="note-item" style="border-bottom: 1px solid var(--border); padding-bottom: 12px; margin-bottom: 12px;">
            <div class="note-header" style="display: flex; justify-content: space-between; margin-bottom: 4px;">
              <span class="note-title" style="font-weight: 500; font-size: 0.95rem; color: var(--text-light);">${escapeHtml((n.text || '').substring(0, 25))}...</span>
              <span class="note-time" style="color: var(--accent-blue); font-size: 0.8rem; font-family: monospace;">${formatTime(n.time)}</span>
            </div>
            <p class="note-preview" style="color: var(--text-muted); font-size: 0.85rem; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin: 0;">${escapeHtml(n.text)}</p>
          </div>
        `).join('');
      }
    }

    const continueGrid = document.getElementById('dashboardContinueWatching');
    
    if (!continueGrid) return;
    
    const subs = await loadSubjects();
    const subjectIds = new Set(subs.map(s => s.id));
    const playedLectures = loadPlayedLectures();
    const validPlayedLectures = dedupePlayedLectures(playedLectures.filter(l => subjectIds.has(l.subjectId)));
    if (validPlayedLectures.length !== playedLectures.length) {
      localStorage.setItem(DASHBOARD_PLAYED_KEY, JSON.stringify(validPlayedLectures));
    }
    
    if (continueGrid) {
      continueGrid.innerHTML = '';
      
      let recentLectures = [];
      if (dashboardShowAllLectures) {
        recentLectures = validPlayedLectures;
      } else {
        recentLectures = validPlayedLectures.slice(0, 2);
      }

      const visibleLectures = dashboardShowAllLectures ? recentLectures : recentLectures.slice(0, 2);
      const viewAllBtn = document.getElementById('dashboardViewAllBtn');
      if (viewAllBtn) {
        viewAllBtn.textContent = dashboardShowAllLectures ? 'Show Less' : 'View All';
        viewAllBtn.setAttribute('aria-expanded', dashboardShowAllLectures ? 'true' : 'false');
        viewAllBtn.onclick = () => {
          dashboardShowAllLectures = !dashboardShowAllLectures;
          localStorage.setItem(DASHBOARD_VIEW_ALL_KEY, dashboardShowAllLectures ? '1' : '0');
          renderDashboard();
        };
      }

      if (visibleLectures.length === 0) {
        continueGrid.innerHTML = '<div style="color:var(--text-muted); grid-column: 1/-1;">No recent lectures found. Add a playlist or video to a subject to start watching!</div>';
      } else {
        for (const l of visibleLectures) {
          const sub = subs.find(s => s.id === l.subjectId);
          const subName = sub ? sub.name : 'Unknown Subject';
          
          const card = document.createElement('a');
          card.href = 'video.html';
          card.className = 'glass-card video-card';
          card.style.textDecoration = 'none';
      card.onclick = () => {
            localStorage.setItem('studyflow:activeLecture', JSON.stringify(l));
            recordPlayedLecture(l);
            localStorage.setItem('studyflow:currentSubject', l.subjectId);
          };
          
          card.innerHTML = `
            <div class="thumbnail">
              <img src="https://img.youtube.com/vi/${l.youtubeId}/mqdefault.jpg" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'320\' height=\'180\'><rect width=\'100%\' height=\'100%\' fill=\'%231f2937\'/><text x=\'50%\' y=\'50%\' fill=\'%239ca3af\' font-family=\'sans-serif\' font-size=\'14\' text-anchor=\'middle\' dy=\'.3em\'>No Thumbnail</text></svg>'" alt="${l.title}">
              <div class="play-overlay"><div class="play-icon"><i data-lucide="play" fill="currentColor"></i></div></div>
            </div>
            <div class="video-info">
              <span class="badge badge-purple" style="margin-bottom: 8px;">${subName}</span>
              <h3 style="color:white;font-weight:600;font-size:1.05rem;margin-bottom:4px;line-height:1.4;">${l.title}</h3>
              <p style="color:var(--text-muted);font-size:0.85rem">Duration: ${l.duration || '--:--'}</p>
            </div>
          `;
          continueGrid.appendChild(card);
        }
      }
    }
    
    if (window.lucide) window.lucide.createIcons();
    document.body.classList.add('dashboard-ready');
  }

  // init
  await checkServer();
  await hydrateSettingsFromServer();
  applyTheme(); // Apply saved theme immediately
  initSettingsControls();
  const subjects = await loadSubjects();
  await reconcileWatchLectureState(subjects);
  renderActiveLectureView();
  if (activeLecture) {
    recordPlayedLecture(activeLecture);
  }
  initSubjectPanelDelegation(); // attach delegated subject delete/select handler BEFORE rendering
  await renderSubjectSelect();
  await renderSubjectsList();
  await renderLecturesList();
  await renderNotes(searchNotes? (searchNotes.value||'') : '');
  await renderSidebarPlaylist();
  await renderDashboard();
  await renderSettingsSubjects();

  // ── H6: Dashboard search ──
  const dashboardSearchInput = document.getElementById('dashboardSearch');
  if (dashboardSearchInput) {
    dashboardSearchInput.addEventListener('input', (e) => {
      const query = e.target.value.trim().toLowerCase();
      const cards = document.querySelectorAll('#dashboardContinueWatching .video-card');
      cards.forEach(card => {
        if (!query) {
          card.style.display = '';
          return;
        }
        const text = card.textContent.toLowerCase();
        card.style.display = text.includes(query) ? '' : 'none';
      });
    });
  }

  // Wire up tabs
  const tabNotesBtn = document.getElementById('tabNotesBtn');
  const tabLecturesBtn = document.getElementById('tabLecturesBtn');
  const notesTabContent = document.getElementById('notesTabContent');
  const lecturesTabContent = document.getElementById('lecturesTabContent');
  
  if (tabNotesBtn && tabLecturesBtn) {
    tabNotesBtn.addEventListener('click', () => {
      tabNotesBtn.classList.add('active');
      tabNotesBtn.style.color = 'white';
      tabNotesBtn.style.borderBottom = '2px solid var(--accent-blue)';
      tabLecturesBtn.classList.remove('active');
      tabLecturesBtn.style.color = 'var(--text-muted)';
      tabLecturesBtn.style.borderBottom = 'none';
      notesTabContent.style.display = 'flex';
      lecturesTabContent.style.display = 'none';
    });
    
    tabLecturesBtn.addEventListener('click', async () => {
      tabLecturesBtn.classList.add('active');
      tabLecturesBtn.style.color = 'white';
      tabLecturesBtn.style.borderBottom = '2px solid var(--accent-blue)';
      tabNotesBtn.classList.remove('active');
      tabNotesBtn.style.color = 'var(--text-muted)';
      tabNotesBtn.style.borderBottom = 'none';
      notesTabContent.style.display = 'none';
      lecturesTabContent.style.display = 'flex';
      await renderSidebarPlaylist();
    });
  }

  // expose small helpers for modal buttons generated in strings
  window.escapeHtml = escapeHtml;
  // expose subject page helpers for inline HTML callbacks
  window.selectSubject = selectSubject;
  window.closeCreateModal = () => {
    document.getElementById('createSubjectModal')?.classList.remove('open');
    const inp = document.getElementById('newSubjectName');
    if (inp) inp.value = '';
  };

  // Import status feedback helper
  const importStatusEl = document.getElementById('importStatus');
  function showImportStatus(msg, color='var(--text-muted)') {
    if (!importStatusEl) return;
    importStatusEl.style.display = 'block';
    importStatusEl.style.color = color;
    importStatusEl.textContent = msg;
  }

  // Heartbeat for Study Hours tracking
  if (window.location.pathname.includes('video.html') || document.querySelector('.video-player-container')) {
    setInterval(() => {
      let isPlaying = false;
      if (typeof ytPlayer !== 'undefined' && ytPlayer && typeof ytPlayer.getPlayerState === 'function') {
        isPlaying = (ytPlayer.getPlayerState() === 1);
      } else if (video && !video.paused) {
        isPlaying = true;
      }
      if (isPlaying) {
        const p = markStudyActivity(loadProfile());
        p.studySeconds = (p.studySeconds || 0) + 5;
        saveProfile(p);
      }
    }, 5000);
  }

})().catch(err => {
  console.error('StudyFlow failed to start:', err);
  const banner = document.createElement('div');
  banner.style.cssText = 'position:fixed;left:16px;right:16px;bottom:16px;z-index:10000;background:#7f1d1d;color:white;border:1px solid rgba(255,255,255,0.2);border-radius:10px;padding:12px 14px;font:14px Inter,system-ui,sans-serif;';
  banner.textContent = 'StudyFlow could not start. Refresh the page, or clear browser storage if this keeps happening.';
  document.body.appendChild(banner);
});
