const auth = {
  tokenKey: "site_token",
  get token() {
    return localStorage.getItem(this.tokenKey);
  },
  set token(v) {
    if (v) localStorage.setItem(this.tokenKey, v);
    else localStorage.removeItem(this.tokenKey);
  },
};

const api = {
  async _fetch(path, opts = {}) {
    opts.headers = opts.headers || {};
    if (auth.token) opts.headers.Authorization = `Bearer ${auth.token}`;
    const res = await fetch(path, opts);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  async list(kind, page = 0, limit = 6) {
    const q = new URLSearchParams({ ...(kind ? { kind } : {}), page, limit });
    return this._fetch(`/api/entries?${q.toString()}`);
  },
  async create(payload) {
    return this._fetch("/api/entries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  },
  async edit(id, payload) {
    return this._fetch(`/api/entries/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  },
  async remove(id) {
    return this._fetch(`/api/entries/${id}`, { method: "DELETE" });
  },
  async register(username, password) {
    return this._fetch("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
  },
  async login(username, password) {
    return this._fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
  },
};

// small helper to query DOM nodes (used later)
function el(sel) {
  return document.querySelector(sel);
}

function makeCard(entry, currentUser) {
  const div = document.createElement("div");
  div.className = "card";
  // content area (meta, title, preview)
  const content = document.createElement('div');
  content.className = 'card-content';
  const meta = document.createElement("div");
  meta.className = "meta";
  // only show username and last edited datetime (if present)
  const updated = entry.updatedAt ? new Date(entry.updatedAt).toLocaleString() : null;
  meta.textContent = entry.ownerName || "anon";
  if (updated) meta.textContent += ` \u2022 edited ${updated}`;
  content.appendChild(meta);
  if (entry.title) {
    const h = document.createElement("h3");
    h.textContent = entry.title;
    content.appendChild(h);
  }
  const p = document.createElement("div");
  p.className = "card-body";
  // show trimmed preview to avoid overflow
  const preview = (entry.body || '').replace(/<[^>]+>/g, '');
  const maxChars = 220;
  if (preview.length > maxChars) {
    p.innerHTML = preview.slice(0, maxChars) + '...';
  } else {
    p.innerHTML = preview;
  }
  content.appendChild(p);
  div.appendChild(content);

  // actions footer (always present for consistent layout)
  const actions = document.createElement("div");
  actions.className = "card-actions";
  // View button - available to everyone
  const viewBtn = document.createElement('button');
  viewBtn.textContent = 'View';
  viewBtn.className = 'view-btn';
  viewBtn.addEventListener('click', ()=>{
    if(window.openView) window.openView(entry);
    else {
      // fallback: show read-modal
      const rm = document.getElementById('read-modal');
      document.getElementById('read-title').textContent = entry.title || '';
      document.getElementById('read-body').innerHTML = entry.body;
      rm.setAttribute('aria-hidden','false');
    }
  });
  actions.appendChild(viewBtn);

  // edit/delete only for owner
  if (currentUser && entry.ownerName === currentUser) {
    const editBtn = document.createElement("button");
    editBtn.textContent = "Edit";
    const delBtn = document.createElement("button");
    delBtn.textContent = "Delete";
    editBtn.addEventListener("click", () => {
      if (window.openComposeForEdit) window.openComposeForEdit(entry);
      else {
        // fallback: try to set modal directly if variables are available
        try {
          editEntryId = entry._id;
          composeKindSel.value = entry.kind || "thought";
          composeTitle.value = entry.title || "";
          composeQuill.root.innerHTML = entry.body || "";
          composeSubmit.textContent = "Save";
          composeModal.setAttribute("aria-hidden", "false");
        } catch (e) {
          console.error("Edit open failed", e);
        }
      }
    });
    delBtn.addEventListener("click", async () => {
      if (!confirm("Delete this entry?")) return;
      try {
        await api.remove(entry._id);
        div.remove();
      } catch (e) {
        alert("Delete failed");
      }
    });
    actions.appendChild(editBtn);
    actions.appendChild(delBtn);
  }
  div.appendChild(actions);
  return div;
}

async function refreshList(
  kind,
  container,
  page = 0,
  append = false,
  opts = {}
) {
  try {
    if (!append) container.innerHTML = '<div class="muted">Loading...</div>';
    const limit = opts.limit || 3;
    const q = opts.q || undefined;
    // build query string
    const params = new URLSearchParams();
    if (kind) params.set("kind", kind);
    params.set("page", page);
    params.set("limit", limit);
    if (q) params.set("q", q);
    const items = await api._fetch(`/api/entries?${params.toString()}`);
    if (items.length === 0 && !append)
      container.innerHTML = '<div class="muted">No entries yet.</div>';
    else {
      if (!append) container.innerHTML = "";
      const currentUser = localStorage.getItem("site_user");
      items.forEach((it) => container.appendChild(makeCard(it, currentUser)));
      const parent = container.parentElement;
      let lm = parent.querySelector(".view-more");
      const curPageAttr = parseInt(container.getAttribute("data-page") || 0);
      const shouldShowToggle = items.length >= limit || curPageAttr > 0;
      if (shouldShowToggle) {
        if (!lm) {
          lm = document.createElement("button");
          lm.className = "view-more";
          parent.appendChild(lm);
          lm.addEventListener("click", () => {
            const curPage = parseInt(container.getAttribute("data-page") || 0);
            if (curPage > 0) {
              // collapse back to page 0
              container.removeAttribute("data-page");
              lm.textContent = "View more";
              refreshList(kind, container, 0, false, opts);
            } else {
              // expand one more page
              const next = curPage + 1;
              container.setAttribute("data-page", next);
              lm.textContent = "View less";
              refreshList(kind, container, next, true, opts);
            }
          });
        }
        // ensure text matches current state
        lm.textContent = curPageAttr > 0 ? "View less" : "View more";
      } else if (lm) {
        lm.remove();
      }
    }
  } catch (e) {
    container.innerHTML = '<div class="muted">Failed to load.</div>';
    console.error(e);
  }
}

function wireForm(formSel, kind, listContainer, quill) {
  const f = document.querySelector(formSel);
  f.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const data = new FormData(f);
    const title = data.get("title") || "";
    const body = quill ? quill.root.innerHTML : data.get("body") || "";
    try {
      const btn = f.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.textContent = "Posting...";
      const res = await api.create({ kind, title, body });
      f.reset();
      if (quill) quill.setText("");
      localStorage.setItem(
        "site_user",
        res.ownerName || localStorage.getItem("site_user")
      );
      await refreshList(kind, listContainer);
      btn.disabled = false;
      btn.textContent = btn.getAttribute("data-label") || "Post";
    } catch (err) {
      console.error(err);
      alert("Could not post entry.");
    }
  });
}

async function handleRegister(username, password) {
  const r = await api.register(username, password);
  if (r.token) {
    auth.token = r.token;
    localStorage.setItem("site_user", r.username);
  }
}
async function handleLogin(username, password) {
  const r = await api.login(username, password);
  if (r.token) {
    auth.token = r.token;
    localStorage.setItem("site_user", r.username);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  // only initialize per-panel editors if the elements exist (we replaced inline forms with Create buttons)
  let thoughtQuill = null,
    learningQuill = null,
    noteQuill = null;
  if (document.querySelector("#thought-editor"))
    thoughtQuill = new Quill("#thought-editor", { theme: "snow" });
  if (document.querySelector("#learning-editor"))
    learningQuill = new Quill("#learning-editor", { theme: "snow" });
  if (document.querySelector("#note-editor"))
    noteQuill = new Quill("#note-editor", { theme: "snow" });

  // Compose modal quill with richer toolbar
  const composeToolbarOptions = [
    [{ header: [1, 2, 3, false] }],
    ["bold", "italic", "underline", "strike"],
    ["blockquote", "code-block"],
    [{ list: "ordered" }, { list: "bullet" }],
    ["link", "image"],
    ["clean"],
  ];
  const composeQuill = new Quill("#compose-editor", {
    theme: "snow",
    modules: { toolbar: composeToolbarOptions },
  });
  const composeModal = document.getElementById("compose-modal");
  const composeBtn = document.getElementById("compose-btn");
  const composeClose = document.getElementById("compose-close");
  const composeSubmit = document.getElementById("compose-submit");
  const composeImage = document.getElementById("compose-image");
  const composeTitle = document.getElementById("compose-title");
  const composeKindSel = document.getElementById("compose-kind");
  // edit mode state: null means creating, otherwise holds entry id being edited
  let editEntryId = null;

  composeBtn.addEventListener("click", () => {
    editEntryId = null;
    composeSubmit.textContent = "Post";
    composeKindSel.value = "thought";
    composeTitle.value = "";
  composeQuill.enable(true);
  composeTitle.disabled = false;
  composeKindSel.disabled = false;
  composeImage.disabled = false;
    composeSubmit.style.display = '';
    composeQuill.setText("");
    composeModal.setAttribute("aria-hidden", "false");
    // focus the editor after modal opens
    setTimeout(() => {
      try {
        composeQuill.focus();
      } catch (e) {}
    }, 120);
  });
  composeClose.addEventListener("click", () => {
    composeModal.setAttribute("aria-hidden", "true");
    editEntryId = null;
    composeSubmit.textContent = "Post";
    composeQuill.enable(true);
    composeSubmit.style.display = '';
    // restore inputs
    try {
      composeTitle.disabled = false;
      composeKindSel.disabled = false;
      composeImage.disabled = false;
    } catch (e) {}
  });

  // global view function: open compose modal in read-only mode
  window.openView = function(entry){
    editEntryId = null;
    composeKindSel.value = entry.kind || 'thought';
    // populate fields but make everything read-only
    composeTitle.value = entry.title || '';
    composeQuill.root.innerHTML = entry.body || '';
    composeQuill.enable(false);
    composeSubmit.style.display = 'none';
    try {
      composeTitle.disabled = true;
      composeKindSel.disabled = true;
      composeImage.disabled = true;
    } catch (e) {}
    composeModal.setAttribute('aria-hidden','false');
  };

  // intercept image button in toolbar to use the compose file input
  const toolbar = composeQuill.getModule("toolbar");
  if (toolbar) {
    toolbar.addHandler("image", () => {
      // trigger the hidden file input
      composeImage.click();
    });
  }

  // image upload -> POST /api/images
  composeImage.addEventListener("change", async (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    try {
      const b = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result.split(",")[1]);
        r.onerror = rej;
        r.readAsDataURL(f);
      });
      const payload = { mime: f.type, data: b };
      const res = await fetch("/api/images-json", {
        method: "POST",
        headers: Object.assign(
          { "content-type": "application/json" },
          auth.token ? { Authorization: `Bearer ${auth.token}` } : {}
        ),
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("upload fail");
      const j = await res.json();
      const range = composeQuill.getSelection(true);
      composeQuill.insertEmbed(range.index, "image", j.url);
    } catch (err) {
      alert("Image upload failed (login required)");
      console.error(err);
    }
  });

  composeSubmit.addEventListener("click", async () => {
    const title = composeTitle.value || "";
    const kind = composeKindSel.value;
    const body = composeQuill.root.innerHTML;
    try {
      composeSubmit.disabled = true;
      composeSubmit.textContent = editEntryId ? "Saving..." : "Posting...";
      if (editEntryId) {
        await api.edit(editEntryId, { title, body });
      } else {
        await api.create({ kind, title, body });
      }
      composeModal.setAttribute("aria-hidden", "true");
      // refresh corresponding list
      if (kind === "thought")
        refreshList("thought", document.getElementById("thoughts-list"));
      if (kind === "learning")
        refreshList("learning", document.getElementById("learnings-list"));
      if (kind === "note")
        refreshList("note", document.getElementById("notes-list"));
      // reset edit mode
      editEntryId = null;
      composeSubmit.textContent = "Post";
      composeTitle.value = "";
      composeQuill.setText("");
    } catch (err) {
      alert("Post failed");
      console.error(err);
    } finally {
      composeSubmit.disabled = false;
    }
  });

  const thoughtsList = el("#thoughts-list");
  const learningsList = el("#learnings-list");
  const notesList = el("#notes-list");

  refreshList("thought", thoughtsList);
  refreshList("learning", learningsList);
  refreshList("note", notesList);

  // wire Create buttons (open compose modal and preselect kind)
  document.querySelectorAll(".create-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const k = btn.dataset.kind || "thought";
      composeKindSel.value = k;
      composeTitle.value = "";
      composeQuill.setText("");
      composeModal.setAttribute("aria-hidden", "false");
    });
  });

  // auth controls: use existing login button if present, otherwise create one
  const nav = document.querySelector(".navbar");
  let loginBtn = document.getElementById("login-btn");
  if (!loginBtn) {
    loginBtn = document.createElement("button");
    loginBtn.id = "login-btn";
    loginBtn.textContent = "Login";
    nav.appendChild(loginBtn);
  }

  // small auth popup (hidden by default)
  const authPopup = document.createElement("div");
  authPopup.className = "auth-popup";
  authPopup.style.display = "none";
  const aUser = document.createElement("input");
  aUser.placeholder = "username";
  const aPass = document.createElement("input");
  aPass.type = "password";
  aPass.placeholder = "password";
  const aReg = document.createElement("button");
  aReg.textContent = "Register";
  const aLog = document.createElement("button");
  aLog.textContent = "Login";
  const aClose = document.createElement("button");
  aClose.textContent = "×";
  aClose.className = "auth-close";
  authPopup.appendChild(aClose);
  authPopup.appendChild(aUser);
  authPopup.appendChild(aPass);
  authPopup.appendChild(aReg);
  authPopup.appendChild(aLog);
  nav.appendChild(authPopup);

  loginBtn.addEventListener("click", () => {
    authPopup.style.display =
      authPopup.style.display === "none" ? "flex" : "none";
  });
  aClose.addEventListener("click", () => (authPopup.style.display = "none"));

  // update header auth UI without reloading
  function updateAuthUI() {
    const current = localStorage.getItem("site_user");
    // remove any existing badge/logout
    const existingBadge = nav.querySelector(".user-badge");
    if (existingBadge) existingBadge.remove();
    const existingLogout = nav.querySelector("#logout-btn");
    if (existingLogout) existingLogout.remove();
    // if logged in, show user and logout
    if (auth.token && current) {
      loginBtn.style.display = "none";
      authPopup.style.display = "none";
      const badge = document.createElement("div");
      badge.className = "user-badge";
      badge.textContent = current;
      badge.style.color = "var(--accent)";
      badge.style.padding = "6px 8px";
      badge.style.borderRadius = "8px";
      badge.style.border = "1px solid rgba(255,255,255,0.04)";
      nav.appendChild(badge);
      const logout = document.createElement("button");
      logout.id = "logout-btn";
      logout.textContent = "Logout";
      logout.addEventListener("click", () => {
        auth.token = null;
        localStorage.removeItem("site_user");
        updateAuthUI();
      });
      nav.appendChild(logout);
    } else {
      loginBtn.style.display = "inline-block";
    }
  }

  aReg.addEventListener("click", async () => {
    try {
      await handleRegister(aUser.value, aPass.value);
      updateAuthUI();
    } catch (e) {
      alert("Register failed");
      console.error(e);
    }
  });
  aLog.addEventListener("click", async () => {
    try {
      await handleLogin(aUser.value, aPass.value);
      updateAuthUI();
    } catch (e) {
      alert("Login failed");
      console.error(e);
    }
  });

  // on load reflect current auth state
  updateAuthUI();

  // read modal close
  const readModal = document.getElementById("read-modal");
  const readClose = document.getElementById("read-close");
  if (readClose)
    readClose.addEventListener("click", () =>
      readModal.setAttribute("aria-hidden", "true")
    );

  // header search wiring
  const headerSearch = document.getElementById("header-search");
  if (headerSearch) {
    let searchTimer = null;
    headerSearch.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        const q = headerSearch.value.trim();
        // refresh current panels with query
        refreshList(
          "thought",
          document.getElementById("thoughts-list"),
          0,
          false,
          { limit: 3, q }
        );
        refreshList(
          "learning",
          document.getElementById("learnings-list"),
          0,
          false,
          { limit: 3, q }
        );
        refreshList("note", document.getElementById("notes-list"), 0, false, {
          limit: 3,
          q,
        });
      }, 300);
    });
  }

  // expose a simple helper so inline onclick handlers from HTML can open compose
  window.openCompose = function (kind) {
    editEntryId = null;
    composeSubmit.textContent = "Post";
    composeKindSel.value = kind || "thought";
    composeTitle.value = "";
    try {
      composeTitle.disabled = false;
      composeKindSel.disabled = false;
      composeImage.disabled = false;
      composeQuill.enable(true);
    } catch (e) {}
    composeQuill.setText("");
    composeModal.setAttribute("aria-hidden", "false");
  };

  // helper to open compose modal preloaded for editing an existing entry
  window.openComposeForEdit = function (entry) {
    editEntryId = entry._id;
    composeKindSel.value = entry.kind || "thought";
    composeTitle.value = entry.title || "";
    try {
      composeTitle.disabled = false;
      composeKindSel.disabled = false;
      composeImage.disabled = false;
      composeQuill.enable(true);
    } catch (e) {}
    composeQuill.root.innerHTML = entry.body || "";
    composeSubmit.textContent = "Save";
    composeModal.setAttribute("aria-hidden", "false");
  };

  // nav scroll
  document.querySelectorAll(".navbar button[data-target]").forEach((b) => {
    b.addEventListener("click", () => {
      const target = document.getElementById(b.dataset.target);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
});
