/* Feature Tracker — plain JS, Supabase for shared storage. */
(() => {
  const cfg = window.TRACKER_CONFIG || {};
  const STATUSES = ["Request", "Accepted", "In Development", "Complete"];
  const STATUS_COLOR = {
    "Request": "#868e96", "Accepted": "#1c7ed6",
    "In Development": "#f08c00", "Complete": "#2f9e44",
  };
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtDate = (d) => d ? new Date(d + "T00:00:00").toLocaleDateString(undefined,
    { day: "numeric", month: "short", year: "numeric" }) : "—";
  const todayISO = () => new Date().toISOString().slice(0, 10);

  document.title = cfg.appName || "Feature Tracker";
  $("#appName").textContent = cfg.appName || "Feature Tracker";

  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);
  let rows = [];
  let user = null;
  let editingId = null;
  let sort = { key: "expected_date", desc: false };
  let channel = null;

  function toast(msg, ms = 2600) {
    const t = $("#toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), ms);
  }

  /* ---------- Auth ---------- */
  async function initAuth() {
    const { data } = await sb.auth.getSession();
    setUser(data.session?.user || null);
    sb.auth.onAuthStateChange((_e, session) => setUser(session?.user || null));
  }

  function setUser(u) {
    const changed = (u?.id || null) !== (user?.id || null);
    user = u;
    $("#authView").hidden = !!u;
    $("#appView").hidden = !u;
    $("#exportBtn").hidden = !u;
    $("#signOutBtn").hidden = !u;
    $("#userEmail").textContent = u?.email || "";
    if (u && changed) { load(); subscribe(); }
    if (!u && channel) { sb.removeChannel(channel); channel = null; }
  }

  $("#authForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#authEmail").value.trim();
    $("#authMsg").textContent = "Sending…";
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: location.href.split("#")[0] },
    });
    $("#authMsg").textContent = error
      ? (/signups not allowed|not found/i.test(error.message)
          ? "That email hasn't been invited yet. Ask the tracker owner to invite you."
          : "Couldn't send link: " + error.message)
      : "Check your inbox for the sign-in link.";
  });
  $("#signOutBtn").addEventListener("click", () => sb.auth.signOut());

  /* ---------- Data ---------- */
  async function load() {
    const { data, error } = await sb.from("feature_requests").select("*").order("created_at");
    if (error) return toast("Couldn't load requests: " + error.message, 5000);
    rows = data; render();
  }

  function subscribe() {
    if (channel) sb.removeChannel(channel);
    channel = sb.channel("fr-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "feature_requests" }, (p) => {
        if (p.eventType === "DELETE") rows = rows.filter((r) => r.id !== p.old.id);
        else {
          const i = rows.findIndex((r) => r.id === p.new.id);
          if (i >= 0) rows[i] = p.new; else rows.push(p.new);
        }
        render();
      })
      .subscribe();
  }

  function formData() {
    const f = new FormData($("#reqForm"));
    const o = Object.fromEntries(f.entries());
    for (const k in o) { o[k] = o[k].trim(); if (o[k] === "") o[k] = null; }
    o.updated_by = user?.email || null;
    return o;
  }

  $("#reqForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = formData();
    const btn = $("#saveBtn"); btn.disabled = true;
    const q = editingId
      ? sb.from("feature_requests").update(payload).eq("id", editingId).select().single()
      : sb.from("feature_requests").insert(payload).select().single();
    const { data, error } = await q;
    btn.disabled = false;
    if (error) return toast("Save failed: " + error.message, 5000);
    const i = rows.findIndex((r) => r.id === data.id);
    if (i >= 0) rows[i] = data; else rows.push(data);
    toast(editingId ? "Request updated" : "Request added");
    resetForm(); render();
  });

  function startEdit(id) {
    const r = rows.find((x) => x.id === id); if (!r) return;
    editingId = id;
    const f = $("#reqForm");
    for (const k of ["title", "description", "requested_by", "assigned_to", "status", "expected_date"])
      f.elements[k].value = r[k] ?? (k === "status" ? "Request" : "");
    $("#formTitle").textContent = "Edit request";
    $("#saveBtn").textContent = "Save changes";
    $("#cancelEdit").hidden = false;
    f.scrollIntoView({ behavior: "smooth", block: "center" });
    f.elements.title.focus();
  }
  function resetForm() {
    editingId = null; $("#reqForm").reset();
    $("#formTitle").textContent = "New feature request";
    $("#saveBtn").textContent = "Add request";
    $("#cancelEdit").hidden = true;
  }
  $("#cancelEdit").addEventListener("click", resetForm);

  async function setStatus(id, status) {
    const { data, error } = await sb.from("feature_requests")
      .update({ status, updated_by: user?.email || null }).eq("id", id).select().single();
    if (error) { toast("Update failed: " + error.message, 5000); return load(); }
    rows[rows.findIndex((r) => r.id === id)] = data; render();
  }

  async function remove(id) {
    const r = rows.find((x) => x.id === id);
    if (!confirm(`Delete "${r?.title}"? This can't be undone.`)) return;
    const { error } = await sb.from("feature_requests").delete().eq("id", id);
    if (error) return toast("Delete failed: " + error.message, 5000);
    rows = rows.filter((x) => x.id !== id);
    if (editingId === id) resetForm();
    render();
  }

  /* ---------- Rendering ---------- */
  function filtered() {
    const q = $("#search").value.toLowerCase().trim();
    const st = $("#filterStatus").value;
    const dev = $("#filterDev").value;
    return rows.filter((r) =>
      (!st || r.status === st) &&
      (!dev || r.assigned_to === dev) &&
      (!q || [r.title, r.description, r.requested_by, r.assigned_to].some((v) => (v || "").toLowerCase().includes(q))));
  }

  function sorted(list) {
    const { key, desc } = sort;
    const val = (r) => key === "status" ? STATUSES.indexOf(r.status) : (r[key] || "");
    return [...list].sort((a, b) => {
      const va = val(a), vb = val(b);
      if (va === "" && vb !== "") return 1;
      if (vb === "" && va !== "") return -1;
      const c = va < vb ? -1 : va > vb ? 1 : 0;
      return desc ? -c : c;
    });
  }

  function render() {
    // stats
    $("#stats").innerHTML = STATUSES.map((s) =>
      `<div class="stat" style="--c:${STATUS_COLOR[s]}"><b>${rows.filter((r) => r.status === s).length}</b><span>${s}</span></div>`).join("");

    // people suggestions + developer filter
    const people = [...new Set(rows.flatMap((r) => [r.requested_by, r.assigned_to]).filter(Boolean))].sort();
    $("#peopleList").innerHTML = people.map((p) => `<option value="${esc(p)}">`).join("");
    const devs = [...new Set(rows.map((r) => r.assigned_to).filter(Boolean))].sort();
    const fd = $("#filterDev"), cur = fd.value;
    fd.innerHTML = `<option value="">All developers</option>` + devs.map((d) => `<option>${esc(d)}</option>`).join("");
    fd.value = devs.includes(cur) ? cur : "";

    // table
    const today = todayISO();
    const list = sorted(filtered());
    $("#reqTable tbody").innerHTML = list.map((r) => {
      const overdue = r.expected_date && r.expected_date < today && r.status !== "Complete";
      return `<tr>
        <td><b>${esc(r.title)}</b>${r.description ? `<div class="desc">${esc(r.description)}</div>` : ""}</td>
        <td>${esc(r.requested_by) || '<span class="muted">—</span>'}</td>
        <td>${esc(r.assigned_to) || '<span class="muted">Unassigned</span>'}</td>
        <td><select class="status-select" data-id="${r.id}" style="--c:${STATUS_COLOR[r.status]}">
          ${STATUSES.map((s) => `<option${s === r.status ? " selected" : ""}>${s}</option>`).join("")}
        </select></td>
        <td class="${overdue ? "overdue" : ""}" title="${overdue ? "Overdue" : ""}">${fmtDate(r.expected_date)}</td>
        <td class="actions">
          <button class="btn small" data-edit="${r.id}">Edit</button>
          <button class="btn small danger" data-del="${r.id}">Delete</button>
        </td></tr>`;
    }).join("");
    $("#emptyMsg").hidden = list.length > 0;
    $("#emptyMsg").textContent = rows.length ? "No requests match these filters." : "No requests yet. Add the first one above.";
    document.querySelectorAll("th[data-sort]").forEach((th) => {
      th.classList.toggle("sorted", th.dataset.sort === sort.key);
      th.classList.toggle("desc", th.dataset.sort === sort.key && sort.desc);
    });
  }

  $("#reqTable").addEventListener("click", (e) => {
    const t = e.target;
    if (t.dataset.edit) startEdit(t.dataset.edit);
    if (t.dataset.del) remove(t.dataset.del);
    if (t.dataset.sort) {
      sort = { key: t.dataset.sort, desc: sort.key === t.dataset.sort ? !sort.desc : false };
      render();
    }
  });
  $("#reqTable").addEventListener("change", (e) => {
    if (e.target.classList.contains("status-select")) setStatus(e.target.dataset.id, e.target.value);
  });
  ["#search", "#filterStatus", "#filterDev"].forEach((s) => $(s).addEventListener("input", render));

  /* ---------- Export ---------- */
  let exportView = "timeline";

  function legend() {
    return `<div class="legend">${STATUSES.map((s) => `<span><i style="--c:${STATUS_COLOR[s]}"></i>${s}</span>`).join("")}</div>`;
  }
  function header(title) {
    const n = filtered().length;
    return `<h3>${esc(cfg.appName || "Feature Tracker")} — ${title}</h3>
      <div class="sub">${n} request${n === 1 ? "" : "s"} · exported ${fmtDate(todayISO())}</div>`;
  }

  function timelineHTML() {
    const DAY = 86400000;
    const list = [...filtered()].sort((a, b) =>
      (a.expected_date || "9999") < (b.expected_date || "9999") ? -1 : 1);
    const dated = list.filter((r) => r.expected_date);
    const start = (r) => new Date((r.created_at || "").slice(0, 10) + "T00:00:00").getTime();
    const end = (r) => new Date(r.expected_date + "T00:00:00").getTime();
    const now = new Date(todayISO() + "T00:00:00").getTime();

    let min = Math.min(now, ...dated.map(start));
    let max = Math.max(now + 14 * DAY, ...dated.map(end));
    // snap to month boundaries
    const m0 = new Date(min); min = new Date(m0.getFullYear(), m0.getMonth(), 1).getTime();
    const m1 = new Date(max); max = new Date(m1.getFullYear(), m1.getMonth() + 1, 1).getTime();
    const pct = (t) => ((t - min) / (max - min)) * 100;

    const ticks = [];
    for (let d = new Date(min); d.getTime() < max; d.setMonth(d.getMonth() + 1))
      ticks.push({ left: pct(d.getTime()), label: d.toLocaleDateString(undefined, { month: "short", year: "numeric" }) });
    const grid = ticks.map((t) => `<div class="grid-line" style="left:${t.left}%"></div>`).join("");
    const todayLine = `<div class="today" style="left:${pct(now)}%"></div>`;

    const body = list.map((r) => {
      const lbl = `<div class="lbl"><b title="${esc(r.title)}">${esc(r.title)}</b>
        <small>${esc(r.assigned_to || "Unassigned")} · ${r.status}</small></div>`;
      if (!r.expected_date) return lbl + `<div class="track">${grid}<div class="nodate">No expected date</div></div>`;
      let s = Math.min(start(r), end(r)), e2 = end(r);
      const left = pct(s), width = Math.max(pct(e2 + DAY) - left, 0.6);
      return lbl + `<div class="track">${grid}${todayLine}
        <div class="bar" style="left:${left}%;width:${width}%;--c:${STATUS_COLOR[r.status]}">${fmtDate(r.expected_date)}</div></div>`;
    }).join("");

    return `<div class="sheet">${header("Timeline")}${legend().replace("</div>", `<span><i style="--c:#c92a2a;width:3px"></i>Today</span></div>`)}
      <div class="gantt">
        <div class="lbl"></div>
        <div class="axis">${ticks.map((t) => `<div class="tick" style="left:${t.left}%">${t.label}</div>`).join("")}
          </div>
        ${body || `<div></div><div class="nodate">No requests to show.</div>`}
      </div></div>`;
  }

  function boardHTML() {
    const list = filtered();
    const cols = STATUSES.map((s) => {
      const items = list.filter((r) => r.status === s)
        .sort((a, b) => (a.expected_date || "9999") < (b.expected_date || "9999") ? -1 : 1);
      return `<div class="col" style="--c:${STATUS_COLOR[s]}">
        <h4><span>${s}</span><span>${items.length}</span></h4>
        ${items.map((r) => `<div class="tile"><b>${esc(r.title)}</b>
          <div class="meta"><span>${esc(r.assigned_to || "Unassigned")}</span><span>${fmtDate(r.expected_date)}</span></div>
          ${r.requested_by ? `<div class="meta"><span>Requested by ${esc(r.requested_by)}</span></div>` : ""}
        </div>`).join("") || `<div class="meta" style="color:#6b7280;font-size:12px">Nothing here</div>`}
      </div>`;
    }).join("");
    return `<div class="sheet">${header("Status board")}<div class="board">${cols}</div></div>`;
  }

  function renderExport() {
    $("#exportArea").innerHTML = exportView === "timeline" ? timelineHTML() : boardHTML();
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === exportView));
  }

  $("#exportBtn").addEventListener("click", () => { renderExport(); $("#exportDlg").showModal(); });
  $("#closeDlg").addEventListener("click", () => $("#exportDlg").close());
  document.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", () => { exportView = t.dataset.view; renderExport(); }));

  async function snapshot() {
    const el = $("#exportArea .sheet");
    return html2canvas(el, { scale: 2, backgroundColor: "#ffffff", width: el.scrollWidth, windowWidth: el.scrollWidth + 100 });
  }
  const fileBase = () => `feature-${exportView}-${todayISO()}`;

  $("#dlPng").addEventListener("click", async () => {
    const c = await snapshot();
    const a = document.createElement("a");
    a.download = fileBase() + ".png"; a.href = c.toDataURL("image/png"); a.click();
  });
  $("#dlPdf").addEventListener("click", async () => {
    const c = await snapshot();
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight(), m = 24;
    const w = pw - m * 2, h = (c.height * w) / c.width;
    const img = c.toDataURL("image/jpeg", 0.92);
    // paginate tall exports
    let y = 0;
    while (y < h) {
      if (y > 0) pdf.addPage();
      pdf.addImage(img, "JPEG", m, m - y, w, h);
      y += ph - m * 2;
    }
    pdf.save(fileBase() + ".pdf");
  });

  initAuth();
})();
