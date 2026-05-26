/* ======================================================
   Mac IDE 9 — ide.js
   iPad + Safari + Edge-on-iPad compatible
   ====================================================== */
'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  rootHandle:   null,
  virtualTree:  null,   // {path: File} — used on Safari/iPad
  virtualFolder: '',
  tabs:         [],
  activeTabId:  null,
  findMatches:  [],
  findIndex:    0,
  ctxTarget:    null,
};

// ── DOM helpers ───────────────────────────────────────────────────────────────
const $  = id  => document.getElementById(id);
const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };

const dom = {
  sidebar:         $('sidebar'),
  folderName:      $('folder-name'),
  fileTree:        $('file-tree'),
  tabBar:          $('tab-bar'),
  welcome:         $('welcome'),
  editorContainer: $('editor-container'),
  lineNumbers:     $('line-numbers'),
  editor:          $('editor'),
  findBar:         $('find-bar'),
  findInput:       $('find-input'),
  replaceInput:    $('replace-input'),
  findCount:       $('find-count'),
  stLang:          $('st-lang'),
  stFile:          $('st-file'),
  stPos:           $('st-pos'),
  stSize:          $('st-size'),
  searchBox:       $('search-box'),
  ctxMenu:         $('ctx-menu'),
  toastCont:       $('toast-container'),
  titleText:       $('title-bar-text'),
};

// ── Platform detection ────────────────────────────────────────────────────────
// On ALL iOS/iPadOS devices (Safari, Chrome, Edge, Firefox) Apple forces WebKit.
// showDirectoryPicker may exist in the JS namespace on Chromium-based iOS browsers
// but is blocked at runtime by the sandbox. So we ALWAYS use the webkitdirectory
// fallback on any iOS/iPadOS device.
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
            || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// Feature flags — ignore dir/save pickers entirely on iOS
const HAS_DIR_PICKER  = !IS_IOS && ('showDirectoryPicker' in window);
const HAS_FILE_PICKER = !IS_IOS && ('showOpenFilePicker'  in window);
const HAS_SAVE_PICKER = !IS_IOS && ('showSaveFilePicker'  in window);

// Also expose for index.html
window.IS_IPAD = IS_IOS;

// ── Language map ──────────────────────────────────────────────────────────────
const LANG_MAP = {
  js:'JavaScript', mjs:'JavaScript', cjs:'JavaScript',
  ts:'TypeScript', tsx:'TypeScript JSX', jsx:'JavaScript JSX',
  html:'HTML', htm:'HTML', css:'CSS', scss:'SCSS', sass:'SASS', less:'LESS',
  json:'JSON', jsonc:'JSONC', md:'Markdown', mdx:'MDX',
  py:'Python', rb:'Ruby', rs:'Rust', go:'Go',
  c:'C', cc:'C++', cpp:'C++', h:'C Header', hpp:'C++ Header',
  java:'Java', kt:'Kotlin', cs:'C#',
  php:'PHP', swift:'Swift',
  sh:'Shell', bash:'Bash', zsh:'Zsh', ps1:'PowerShell',
  sql:'SQL', yaml:'YAML', yml:'YAML', toml:'TOML',
  xml:'XML', svg:'SVG', vue:'Vue', svelte:'Svelte',
  dart:'Dart', r:'R', lua:'Lua',
  tf:'Terraform', dockerfile:'Dockerfile',
  txt:'Plain Text', env:'ENV', ini:'INI',
  gitignore:'GitIgnore', lock:'Lock File',
};

const FILE_ICONS = {
  js:'[js]', ts:'[ts]', tsx:'[tsx]', jsx:'[jsx]',
  html:'[html]', css:'[css]', scss:'[scss]',
  json:'[json]', md:'[md]', py:'[py]', rb:'[rb]',
  rs:'[rs]', go:'[go]', c:'[c]', cpp:'[cpp]',
  java:'[java]', php:'[php]', swift:'[swift]',
  sh:'[sh]', sql:'[sql]', yaml:'[yaml]', yml:'[yml]',
  xml:'[xml]', svg:'[svg]', vue:'[vue]', svelte:'[svelte]',
  dart:'[dart]', dockerfile:'[docker]', tf:'[tf]',
  txt:'[txt]', env:'[env]', gitignore:'[git]', lock:'[lock]',
};

function getExt(name) {
  const p = name.split('.');
  return p.length === 1 ? name.toLowerCase() : p.pop().toLowerCase();
}
function getLang(name) {
  const ext  = getExt(name);
  const base = name.split('/').pop().toLowerCase();
  if (base === 'dockerfile') return 'Dockerfile';
  if (base === '.gitignore') return 'GitIgnore';
  return LANG_MAP[ext] || LANG_MAP[base] || 'Plain Text';
}
function getIcon(name) { return FILE_ICONS[getExt(name)] || '[?]'; }
function isBinary(name) {
  return ['png','jpg','jpeg','gif','webp','bmp','ico','pdf','zip','tar','gz',
    '7z','rar','exe','bin','wasm','ttf','otf','woff','woff2',
    'mp3','mp4','ogg','wav','flac','mov','avi'].includes(getExt(name));
}

// MIME map so Safari/Edge-iPad saves with the right extension, not .txt
function getMime(name) {
  const ext = getExt(name);
  const map = {
    html:'text/html', htm:'text/html',
    css:'text/css', scss:'text/css', sass:'text/css', less:'text/css',
    js:'text/javascript', mjs:'text/javascript', cjs:'text/javascript',
    ts:'text/typescript', tsx:'text/typescript', jsx:'text/javascript',
    json:'application/json', jsonc:'application/json',
    xml:'application/xml', svg:'image/svg+xml',
    md:'text/markdown', mdx:'text/markdown',
    py:'text/x-python', rb:'text/x-ruby', rs:'text/x-rustsrc',
    go:'text/x-go', c:'text/x-csrc', cpp:'text/x-c++src',
    java:'text/x-java', kt:'text/x-kotlin', cs:'text/x-csharp',
    php:'text/x-php', swift:'text/x-swift',
    sh:'text/x-sh', bash:'text/x-sh', zsh:'text/x-sh',
    sql:'text/x-sql', yaml:'text/yaml', yml:'text/yaml',
    toml:'text/toml', vue:'text/x-vue', svelte:'text/x-svelte',
    dart:'text/x-dart', lua:'text/x-lua', r:'text/x-r',
    tf:'text/plain', dockerfile:'text/plain',
    txt:'text/plain', env:'text/plain', ini:'text/plain',
    gitignore:'text/plain', lock:'text/plain',
  };
  return map[ext] || 'text/plain';
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function toast(msg, type = 'info', duration = 3500) {
  const t = el('div', `toast ${type}`);
  t.textContent = msg;
  dom.toastCont.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transition = 'opacity 0.3s';
    setTimeout(() => t.remove(), 320);
  }, duration);
}

// ── UID ───────────────────────────────────────────────────────────────────────
let _uid = 0;
const uid = () => ++_uid;

// ── OPEN FOLDER ───────────────────────────────────────────────────────────────
async function openFolder() {
  if (HAS_DIR_PICKER) {
    // Desktop Chrome / Edge — native directory picker
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      state.rootHandle  = handle;
      state.virtualTree = null;
      dom.folderName.textContent = handle.name.toUpperCase();
      dom.titleText.textContent  = 'Mac IDE -- ' + handle.name;
      await buildTree();
      toast('Opened: ' + handle.name, 'success');
    } catch (e) {
      if (e.name !== 'AbortError') toast('Could not open folder: ' + e.message, 'error');
    }
    return;
  }

  // iOS / iPadOS (Safari, Chrome, Edge, Firefox) — webkitdirectory fallback
  // This is the ONLY reliable method on all iOS browsers.
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.setAttribute('webkitdirectory', '');
  inp.setAttribute('directory', '');        // Firefox alias
  inp.setAttribute('multiple', '');

  inp.onchange = async () => {
    const files = Array.from(inp.files);
    if (!files.length) {
      toast('No files selected.', 'info');
      return;
    }

    // webkitRelativePath = "FolderName/sub/file.js"
    const firstRel   = files[0].webkitRelativePath || files[0].name;
    const folderName = firstRel.includes('/') ? firstRel.split('/')[0] : 'Files';

    state.rootHandle   = null;
    state.virtualTree  = {};
    state.virtualFolder = folderName;

    const HIDDEN_NAMES = new Set(['.git','node_modules','.DS_Store','__pycache__',
      '.next','.nuxt','dist','build','.cache','.turbo','.venv']);

    let loaded = 0;
    for (const file of files) {
      const relPath = file.webkitRelativePath || file.name;
      const parts   = relPath.split('/');

      // Skip hidden directories anywhere in the path
      if (parts.some(p => HIDDEN_NAMES.has(p))) continue;
      if (isBinary(file.name)) continue;

      state.virtualTree[relPath] = file;
      loaded++;
    }

    dom.folderName.textContent = folderName.toUpperCase();
    dom.titleText.textContent  = 'Mac IDE -- ' + folderName;
    buildVirtualTree();
    toast(`Opened "${folderName}" — ${loaded} files loaded`, 'success');
  };

  // Must be appended to DOM and clicked — some iOS browsers block detached inputs
  inp.style.cssText = 'position:fixed;opacity:0;pointer-events:none;top:0;left:0;';
  document.body.appendChild(inp);
  inp.click();
  setTimeout(() => inp.remove(), 5000);
}

// ── Virtual tree (iOS fallback) ───────────────────────────────────────────────
function buildVirtualTree(filter = '') {
  dom.fileTree.innerHTML = '';
  if (!state.virtualTree) return;

  const fl    = filter.toLowerCase();
  const paths = Object.keys(state.virtualTree).filter(p =>
    !fl || p.toLowerCase().includes(fl)
  );

  if (paths.length === 0) {
    dom.fileTree.innerHTML = '<div class="tree-empty">No matching files.</div>';
    return;
  }

  // Build nested object: { folderName: { subDir: { file: fullPath } } }
  const root = {};
  for (const p of paths) {
    const parts = p.split('/');
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (i === parts.length - 1) {
        node[part] = p;               // leaf = path string
      } else {
        if (typeof node[part] !== 'object') node[part] = {};
        node = node[part];
      }
    }
  }

  const frag = document.createDocumentFragment();
  // Start one level in (skip the root folder itself, show its children)
  const startNode = root[state.virtualFolder] || root;
  renderVirtualNode(startNode, frag, 0);
  dom.fileTree.appendChild(frag);
}

function renderVirtualNode(node, container, depth) {
  const entries = Object.entries(node).sort((a, b) => {
    const aDir = typeof a[1] === 'object';
    const bDir = typeof b[1] === 'object';
    if (aDir !== bDir) return aDir ? -1 : 1;
    return a[0].localeCompare(b[0]);
  });

  for (const [name, value] of entries) {
    if (typeof value === 'object') {
      // Directory
      const folderEl   = el('div', 'tree-item tree-folder');
      const childrenEl = el('div', 'tree-children');
      folderEl.style.paddingLeft = (8 + depth * 14) + 'px';
      folderEl.innerHTML =
        `<span class="arrow">v</span>` +
        `<span class="icon">[dir]</span>` +
        `<span class="name">${name}</span>`;

      renderVirtualNode(value, childrenEl, depth + 1);

      const toggle = (e) => {
        e.stopPropagation();
        if (e.cancelable) e.preventDefault();
        const open = childrenEl.style.display === 'none';
        childrenEl.style.display = open ? '' : 'none';
        folderEl.querySelector('.arrow').textContent = open ? 'v' : '>';
      };

      folderEl.addEventListener('click',    toggle);
      folderEl.addEventListener('touchend', toggle, { passive: false });

      container.appendChild(folderEl);
      container.appendChild(childrenEl);

    } else {
      // File
      const path   = value;
      const fileEl = el('div', 'tree-item');
      fileEl.style.paddingLeft = (8 + depth * 14 + 16) + 'px';
      fileEl.innerHTML =
        `<span class="icon">${getIcon(name)}</span>` +
        `<span class="name">${name}</span>`;
      fileEl.title        = path;
      fileEl.dataset.path = path;

      const openFile = async (e) => {
        if (e.cancelable) e.preventDefault();
        const file = state.virtualTree[path];
        if (!file) return;
        // Already open?
        const existing = state.tabs.find(t => t.path === path);
        if (existing) { setActiveTab(existing.id); return; }
        try {
          const text = await file.text();
          openTabFromContent(name, path, null, text);
          highlightTree(path);
        } catch (err) {
          toast('Could not read file: ' + err.message, 'error');
        }
      };

      fileEl.addEventListener('click',    openFile);
      fileEl.addEventListener('touchend', openFile, { passive: false });
      container.appendChild(fileEl);
    }
  }
}

// ── OPEN FILE(S) ──────────────────────────────────────────────────────────────
async function openFiles() {
  if (HAS_FILE_PICKER) {
    try {
      const handles = await window.showOpenFilePicker({ multiple: true });
      for (const h of handles) await openFileHandle(h);
    } catch (e) {
      if (e.name !== 'AbortError') toast('Could not open: ' + e.message, 'error');
    }
    return;
  }

  // iOS fallback
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.multiple = true;
  inp.style.cssText = 'position:fixed;opacity:0;pointer-events:none;top:0;left:0;';
  document.body.appendChild(inp);

  inp.onchange = async () => {
    for (const file of inp.files) {
      if (isBinary(file.name)) { toast('Skipped binary: ' + file.name, 'info'); continue; }
      try {
        const text = await file.text();
        openTabFromContent(file.name, file.name, null, text);
      } catch (e) {
        toast('Could not read: ' + file.name, 'error');
      }
    }
    inp.remove();
  };

  inp.click();
  setTimeout(() => inp.remove(), 5000);
}

async function openFileHandle(handle, path) {
  if (isBinary(handle.name)) { toast('Skipped binary: ' + handle.name, 'info'); return; }
  const existing = state.tabs.find(t => t.handle === handle || (t.path && t.path === path));
  if (existing) { setActiveTab(existing.id); return; }
  try {
    const file = await handle.getFile();
    openTabFromContent(handle.name, path || handle.name, handle, await file.text());
  } catch (e) { toast('Could not read: ' + e.message, 'error'); }
}

function openTabFromContent(name, path, handle, content) {
  const id = uid();
  state.tabs.push({ id, name, path, handle, content, savedContent: content, lang: getLang(name) });
  renderTabs();
  setActiveTab(id);
}

// ── SAVE ──────────────────────────────────────────────────────────────────────
async function saveTab(tab) {
  if (!tab) return;

  // Desktop Chrome/Edge with existing handle
  if (tab.handle && HAS_SAVE_PICKER) {
    try {
      const w = await tab.handle.createWritable();
      await w.write(tab.content);
      await w.close();
      tab.savedContent = tab.content;
      renderTabs();
      toast('Saved: ' + tab.name, 'success');
      return;
    } catch (e) {
      toast('Save failed: ' + e.message, 'error');
      return;
    }
  }

  // Desktop Chrome/Edge, no handle yet
  if (HAS_SAVE_PICKER) {
    try {
      tab.handle = await window.showSaveFilePicker({ suggestedName: tab.name });
      const w = await tab.handle.createWritable();
      await w.write(tab.content);
      await w.close();
      tab.savedContent = tab.content;
      renderTabs();
      toast('Saved: ' + tab.name, 'success');
      return;
    } catch (e) {
      if (e.name !== 'AbortError') toast('Save failed: ' + e.message, 'error');
      return;
    }
  }

  // iOS / Safari / Edge-iPad: download with correct MIME + filename
  // The Blob MIME type is the key — it tells iOS what extension to use
  const mime = getMime(tab.name);
  const blob = new Blob([tab.content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = tab.name;  // exact filename, e.g. "index.html" not "index.txt"
  a.style.cssText = 'position:fixed;opacity:0;pointer-events:none;top:0;left:0;';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);

  tab.savedContent = tab.content;
  renderTabs();
  toast(`Downloaded: ${tab.name}`, 'success');
}

async function saveAllTabs() {
  const unsaved = state.tabs.filter(t => t.content !== t.savedContent);
  if (!unsaved.length) { toast('All files already saved.', 'info'); return; }
  for (const tab of unsaved) await saveTab(tab);
}

// ── Build tree (desktop with dir handle) ─────────────────────────────────────
const treeState = {};
const HIDDEN = new Set(['.git','node_modules','.DS_Store','__pycache__','.next',
  '.nuxt','dist','build','.cache','.turbo','.venv']);

async function buildTree(filter = '') {
  dom.fileTree.innerHTML = '';
  if (state.virtualTree) { buildVirtualTree(filter); return; }
  if (!state.rootHandle) return;
  const frag = document.createDocumentFragment();
  await renderDir(state.rootHandle, frag, '', 0, filter.toLowerCase());
  dom.fileTree.appendChild(frag);
}

async function renderDir(dirHandle, container, pathPrefix, depth, filter) {
  const entries = [];
  for await (const [name, handle] of dirHandle.entries()) {
    if (HIDDEN.has(name)) continue;
    entries.push({ name, handle });
  }
  entries.sort((a, b) => {
    if (a.handle.kind !== b.handle.kind) return a.handle.kind === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  for (const { name, handle } of entries) {
    const fullPath = pathPrefix ? `${pathPrefix}/${name}` : name;

    if (handle.kind === 'directory') {
      const folderEl  = el('div', 'tree-item tree-folder');
      const isOpen    = treeState[fullPath] !== false;
      folderEl.style.paddingLeft = (8 + depth * 14) + 'px';
      folderEl.innerHTML =
        `<span class="arrow">${isOpen ? 'v' : '>'}</span>` +
        `<span class="icon">[dir]</span>` +
        `<span class="name">${name}</span>`;
      folderEl.title = fullPath;

      const childrenEl = el('div', 'tree-children');
      childrenEl.style.display = isOpen ? '' : 'none';

      const toggle = async (e) => {
        e.stopPropagation();
        if (e.cancelable) e.preventDefault();
        const open = childrenEl.style.display === 'none';
        treeState[fullPath] = open;
        childrenEl.style.display = open ? '' : 'none';
        folderEl.querySelector('.arrow').textContent = open ? 'v' : '>';
        if (open && childrenEl.children.length === 0)
          await renderDir(handle, childrenEl, fullPath, depth + 1, filter);
      };

      folderEl.addEventListener('click',    toggle);
      folderEl.addEventListener('touchend', toggle, { passive: false });
      folderEl.addEventListener('contextmenu', e => showCtx(e, { kind: 'directory', name, path: fullPath, handle }));

      container.appendChild(folderEl);
      container.appendChild(childrenEl);
      if (isOpen) await renderDir(handle, childrenEl, fullPath, depth + 1, filter);

    } else {
      if (filter && !name.toLowerCase().includes(filter)) continue;
      const fileEl = el('div', 'tree-item');
      fileEl.style.paddingLeft = (8 + depth * 14 + 16) + 'px';
      fileEl.innerHTML =
        `<span class="icon">${getIcon(name)}</span>` +
        `<span class="name">${name}</span>`;
      fileEl.title        = fullPath;
      fileEl.dataset.path = fullPath;

      const open = async (e) => {
        if (e.cancelable) e.preventDefault();
        await openFileHandle(handle, fullPath);
        highlightTree(fullPath);
      };

      fileEl.addEventListener('click',    open);
      fileEl.addEventListener('touchend', open, { passive: false });
      fileEl.addEventListener('contextmenu', e => showCtx(e, { kind: 'file', name, path: fullPath, handle }));
      container.appendChild(fileEl);
    }
  }
}

function highlightTree(path) {
  document.querySelectorAll('.tree-item').forEach(e => e.classList.remove('active'));
  const found = document.querySelector(`.tree-item[data-path="${CSS.escape(path)}"]`);
  if (found) { found.classList.add('active'); found.scrollIntoView({ block: 'nearest' }); }
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
function renderTabs() {
  dom.tabBar.innerHTML = '';
  for (const tab of state.tabs) {
    const t = el('div', 'tab' + (tab.id === state.activeTabId ? ' active' : ''));
    t.dataset.id = tab.id;
    const unsaved = tab.content !== tab.savedContent;
    t.innerHTML =
      `<span class="tab-name" title="${tab.path}">${unsaved ? '* ' : ''}${tab.name}</span>` +
      `<span class="tab-close">x</span>`;

    t.addEventListener('click', e => {
      if (e.target.classList.contains('tab-close')) { closeTab(tab.id); return; }
      setActiveTab(tab.id);
    });
    t.addEventListener('touchend', e => {
      e.preventDefault();
      if (e.target.classList.contains('tab-close')) { closeTab(tab.id); return; }
      setActiveTab(tab.id);
    }, { passive: false });

    t.addEventListener('contextmenu', e => showCtx(e, { kind: 'tab', tab }));
    dom.tabBar.appendChild(t);
  }
}

function setActiveTab(id) {
  if (state.activeTabId) {
    const cur = state.tabs.find(t => t.id === state.activeTabId);
    if (cur) cur.content = dom.editor.value;
  }
  state.activeTabId = id;
  const tab = state.tabs.find(t => t.id === id);
  if (!tab) { showWelcome(); return; }
  dom.welcome.style.display         = 'none';
  dom.editorContainer.style.display = 'flex';
  dom.editor.value = tab.content;
  dom.titleText.textContent = 'Mac IDE -- ' + tab.name;
  updateLineNumbers();
  updateStatusBar(tab);
  highlightTree(tab.path);
  renderTabs();
  if (!IS_IOS) dom.editor.focus();
}

function closeTab(id) {
  const tab = state.tabs.find(t => t.id === id);
  if (tab && tab.content !== tab.savedContent) {
    if (!confirm(`"${tab.name}" has unsaved changes. Close anyway?`)) return;
  }
  const idx = state.tabs.findIndex(t => t.id === id);
  state.tabs.splice(idx, 1);
  if (state.activeTabId === id) {
    state.activeTabId = null;
    const next = state.tabs[idx] || state.tabs[idx - 1];
    if (next) setActiveTab(next.id);
    else showWelcome();
  }
  renderTabs();
}

function showWelcome() {
  dom.welcome.style.display         = 'flex';
  dom.editorContainer.style.display = 'none';
  dom.stFile.textContent = 'No file open';
  dom.stLang.textContent = 'Plain Text';
  dom.stPos.textContent  = 'Ln 1, Col 1';
  dom.stSize.textContent = '';
  dom.titleText.textContent = 'Mac IDE -- Untitled';
}

// ── Editor events ─────────────────────────────────────────────────────────────
dom.editor.addEventListener('input', () => {
  const tab = activeTab();
  if (!tab) return;
  tab.content = dom.editor.value;
  updateLineNumbers();
  updateStatusBar(tab);
  const t = dom.tabBar.querySelector(`.tab[data-id="${tab.id}"]`);
  if (t) {
    const nm = t.querySelector('.tab-name');
    if (nm) nm.textContent = (tab.content !== tab.savedContent ? '* ' : '') + tab.name;
  }
});

dom.editor.addEventListener('keydown', e => {
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl) return;

  if (e.key === 'Tab') {
    e.preventDefault();
    const { selectionStart: s, selectionEnd: end, value } = dom.editor;
    if (s !== end) {
      insertAt(s, end, value.slice(s, end).split('\n').map(l => '    ' + l).join('\n'));
    } else {
      insertAt(s, s, '    ');
    }
    return;
  }

  const pairs = { '(':')', '[':']', '{':'}', '"':'"', "'":"'", '`':'`' };
  if (pairs[e.key]) {
    const { selectionStart: s, selectionEnd: end, value } = dom.editor;
    if (s !== end) {
      e.preventDefault();
      insertAt(s, end, e.key + value.slice(s, end) + pairs[e.key]);
      dom.editor.setSelectionRange(s + 1, end + 1);
      return;
    }
  }

  if (e.key === 'Enter') {
    const { selectionStart: s, value } = dom.editor;
    const lineStart = value.lastIndexOf('\n', s - 1) + 1;
    const line      = value.slice(lineStart, s);
    const indent    = line.match(/^(\s*)/)[1];
    const lastChar  = line.trimEnd().slice(-1);
    const extra     = ['{', '(', '['].includes(lastChar) ? '    ' : '';
    e.preventDefault();
    insertAt(s, s, '\n' + indent + extra);
  }
});

dom.editor.addEventListener('scroll',   () => { dom.lineNumbers.scrollTop = dom.editor.scrollTop; });
dom.editor.addEventListener('click',    updateCaret);
dom.editor.addEventListener('keyup',    updateCaret);
dom.editor.addEventListener('touchend', updateCaret, { passive: true });

function insertAt(start, end, text) {
  const { value } = dom.editor;
  dom.editor.value = value.slice(0, start) + text + value.slice(end);
  dom.editor.setSelectionRange(start + text.length, start + text.length);
  dom.editor.dispatchEvent(new Event('input'));
}

function updateLineNumbers() {
  const lines = dom.editor.value.split('\n').length;
  dom.lineNumbers.innerHTML = Array.from({ length: lines }, (_, i) => `<div>${i + 1}</div>`).join('');
  dom.lineNumbers.scrollTop = dom.editor.scrollTop;
}

function updateCaret() {
  const { selectionStart, value } = dom.editor;
  const before = value.slice(0, selectionStart);
  const ln  = before.split('\n').length;
  const col = before.length - before.lastIndexOf('\n');
  dom.stPos.textContent = `Ln ${ln}, Col ${col}`;
}

function updateStatusBar(tab) {
  dom.stLang.textContent = tab.lang;
  dom.stFile.textContent = tab.path;
  const bytes = new Blob([tab.content]).size;
  dom.stSize.textContent = bytes < 1024 ? bytes + ' B' : (bytes / 1024).toFixed(1) + ' KB';
  updateCaret();
}

function activeTab() {
  return state.tabs.find(t => t.id === state.activeTabId) || null;
}

// ── Find / Replace ────────────────────────────────────────────────────────────
function openFind() {
  dom.findBar.classList.add('open');
  const sel = dom.editor.value.slice(dom.editor.selectionStart, dom.editor.selectionEnd);
  if (sel) dom.findInput.value = sel;
  dom.findInput.focus();
  dom.findInput.select();
  doFind();
}
function closeFind() {
  dom.findBar.classList.remove('open');
  if (!IS_IOS) dom.editor.focus();
}
function doFind() {
  const q = dom.findInput.value;
  state.findMatches = []; state.findIndex = 0;
  if (!q) { dom.findCount.textContent = ''; return; }
  const re = new RegExp(escapeRe(q), 'gi');
  let m;
  while ((m = re.exec(dom.editor.value)) !== null) state.findMatches.push(m.index);
  dom.findCount.textContent = state.findMatches.length
    ? `${state.findIndex + 1}/${state.findMatches.length}`
    : 'Not found';
  if (state.findMatches.length) jumpToMatch(0);
}
function jumpToMatch(idx) {
  if (!state.findMatches.length) return;
  state.findIndex = (idx + state.findMatches.length) % state.findMatches.length;
  const pos = state.findMatches[state.findIndex];
  const len = dom.findInput.value.length;
  dom.editor.focus();
  dom.editor.setSelectionRange(pos, pos + len);
  dom.findCount.textContent = `${state.findIndex + 1}/${state.findMatches.length}`;
  const lineIdx = dom.editor.value.slice(0, pos).split('\n').length - 1;
  dom.editor.scrollTop = lineIdx * 22 - dom.editor.clientHeight / 2;
}
function doReplace() {
  if (!state.findMatches.length) return;
  const pos = state.findMatches[state.findIndex];
  const rep = dom.replaceInput.value;
  insertAt(pos, pos + dom.findInput.value.length, rep);
  const tab = activeTab();
  if (tab) tab.content = dom.editor.value;
  doFind();
}
function doReplaceAll() {
  const q = dom.findInput.value; if (!q) return;
  dom.editor.value = dom.editor.value.split(q).join(dom.replaceInput.value);
  const tab = activeTab();
  if (tab) tab.content = dom.editor.value;
  dom.editor.dispatchEvent(new Event('input'));
  doFind();
  toast(`Replaced all "${q}"`, 'success');
}
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

dom.findInput.addEventListener('input', doFind);
dom.findInput.addEventListener('keydown', e => {
  if (e.key === 'Enter')  { e.shiftKey ? jumpToMatch(state.findIndex - 1) : jumpToMatch(state.findIndex + 1); }
  if (e.key === 'Escape') closeFind();
});
$('find-prev').onclick   = () => jumpToMatch(state.findIndex - 1);
$('find-next').onclick   = () => jumpToMatch(state.findIndex + 1);
$('find-close').onclick  = closeFind;
$('replace-one').onclick = doReplace;
$('replace-all').onclick = doReplaceAll;

// ── Context menu ──────────────────────────────────────────────────────────────
function showCtx(e, data) {
  e.preventDefault();
  state.ctxTarget = data;
  dom.ctxMenu.classList.add('open');
  dom.ctxMenu.style.left = Math.min(e.clientX, window.innerWidth  - 180) + 'px';
  dom.ctxMenu.style.top  = Math.min(e.clientY, window.innerHeight - 120) + 'px';
  $('ctx-open').style.display      = data.kind !== 'tab' ? '' : 'none';
  $('ctx-close-tab').style.display = data.kind === 'tab' ? '' : 'none';
}
document.addEventListener('click',    () => dom.ctxMenu.classList.remove('open'));
document.addEventListener('touchend', () => dom.ctxMenu.classList.remove('open'), { passive: true });
$('ctx-open').onclick      = async () => {
  if (state.ctxTarget?.kind === 'file')
    await openFileHandle(state.ctxTarget.handle, state.ctxTarget.path);
};
$('ctx-close-tab').onclick = () => {
  if (state.ctxTarget?.kind === 'tab') closeTab(state.ctxTarget.tab.id);
};
$('ctx-rename').onclick    = () => toast('Rename is not supported by the File System API.', 'info');

// ── Sidebar resize — mouse ────────────────────────────────────────────────────
const resizer = $('resizer');
let resizing = false, startX = 0, startW = 0;
resizer.addEventListener('mousedown', e => {
  resizing = true; startX = e.clientX; startW = $('sidebar').offsetWidth;
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
});
document.addEventListener('mousemove', e => {
  if (!resizing) return;
  $('sidebar').style.width = Math.max(100, Math.min(400, startW + e.clientX - startX)) + 'px';
});
document.addEventListener('mouseup', () => {
  if (!resizing) return;
  resizing = false;
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
});

// ── Sidebar resize — touch ────────────────────────────────────────────────────
resizer.addEventListener('touchstart', e => {
  resizing = true; startX = e.touches[0].clientX; startW = $('sidebar').offsetWidth;
  e.preventDefault();
}, { passive: false });
document.addEventListener('touchmove', e => {
  if (!resizing) return;
  $('sidebar').style.width = Math.max(100, Math.min(400, startW + e.touches[0].clientX - startX)) + 'px';
  e.preventDefault();
}, { passive: false });
document.addEventListener('touchend', () => { resizing = false; }, { passive: true });

// ── File filter ───────────────────────────────────────────────────────────────
let filterTimer;
dom.searchBox.addEventListener('input', () => {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(() => buildTree(dom.searchBox.value), 260);
});

// ── Toolbar buttons ───────────────────────────────────────────────────────────
$('btn-open-folder').onclick    = openFolder;
$('btn-open-file').onclick      = openFiles;
$('btn-save').onclick           = () => saveTab(activeTab());
$('btn-save-all').onclick       = saveAllTabs;
$('btn-find').onclick           = openFind;
$('btn-toggle-sidebar').onclick = () => $('sidebar').classList.toggle('collapsed');

// ── Global keyboard shortcuts (Ctrl / Cmd) ────────────────────────────────────
document.addEventListener('keydown', async e => {
  const ctrl = e.ctrlKey || e.metaKey;
  if (!ctrl) return;
  switch (e.key) {
    case 'o': case 'O':
      e.preventDefault();
      e.shiftKey ? openFolder() : openFiles(); break;
    case 's': case 'S':
      e.preventDefault();
      e.shiftKey ? await saveAllTabs() : await saveTab(activeTab()); break;
    case 'f':
      e.preventDefault(); openFind(); break;
    case 'w':
      e.preventDefault();
      if (state.activeTabId) closeTab(state.activeTabId); break;
    case 'b':
      e.preventDefault();
      $('sidebar').classList.toggle('collapsed'); break;
    case 'Tab':
      e.preventDefault();
      if (!state.tabs.length) break;
      const idx  = state.tabs.findIndex(t => t.id === state.activeTabId);
      const next = state.tabs[(idx + 1) % state.tabs.length];
      if (next) setActiveTab(next.id); break;
    case '=': case '+':
      e.preventDefault(); changeFontSize(1);  break;
    case '-':
      e.preventDefault(); changeFontSize(-1); break;
  }
});

// ── Pinch-to-zoom on editor ───────────────────────────────────────────────────
(function () {
  let lastDist = 0;
  dom.editor.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastDist = Math.hypot(dx, dy);
    }
  }, { passive: true });
  dom.editor.addEventListener('touchmove', e => {
    if (e.touches.length !== 2) return;
    e.preventDefault();
    const dx   = e.touches[0].clientX - e.touches[1].clientX;
    const dy   = e.touches[0].clientY - e.touches[1].clientY;
    const dist = Math.hypot(dx, dy);
    if (lastDist > 0) changeFontSize(dist > lastDist ? 1 : -1);
    lastDist = dist;
  }, { passive: false });
  dom.editor.addEventListener('touchend', () => { lastDist = 0; }, { passive: true });
}());

// ── Unsaved warning ───────────────────────────────────────────────────────────
window.addEventListener('beforeunload', e => {
  if (state.tabs.some(t => t.content !== t.savedContent)) {
    e.preventDefault();
    e.returnValue = 'You have unsaved changes!';
  }
});

// ── Info banner ───────────────────────────────────────────────────────────────
if (IS_IOS) {
  const note = document.createElement('div');
  note.style.cssText =
    'background:#fffbcc;color:#000;padding:4px 10px;font-size:11px;' +
    'text-align:center;border-bottom:1px solid #888;font-family:Geneva,Arial,sans-serif;flex-shrink:0;';
  note.textContent =
    'iPad mode: Tap "Open Folder" to select a folder. ' +
    'Tap "Save" to download files with the correct filename.';
  $('ide-window').insertBefore(note, $('toolbar'));
}
