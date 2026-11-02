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
  const expanded = new Set();
  const DAYMS = 86400000;
  const daysBetween = (a, b) => Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / DAYMS);
  const fmtDateTime = (iso) => iso ? new Date(iso).toLocaleString(undefined,
    { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

  // Show unexpected errors instead of failing silently.
  window.addEventListener("error", (e) => { try { toast("Something went wrong: " + e.message, 6000); } catch (_) {} });
  window.addEventListener("unhandledrejection", (e) => { try { toast("Something went wrong: " + (e.reason?.message || e.reason), 6000); } catch (_) {} });

  function toast(msg, ms = 2600) {
    if (/start_date/.test(msg) && /column|schema/i.test(msg))
      msg = "The database needs a one-time update for start dates: run supabase-migration-002-start-date.sql in Supabase.", ms = 8000;
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
    $("#passBtn").hidden = !u;
    $("#userEmail").textContent = u?.email || "";
    if (u && changed) {
      let v = "list"; try { v = localStorage.getItem("ft-view") || "list"; } catch (_) {}
      setView(v); load(); subscribe();
    }
    if (!u && channel) { sb.removeChannel(channel); channel = null; }
  }

  const authMsg = (t) => ($("#authMsg").textContent = t);
  $("#authForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#authEmail").value.trim(), password = $("#authPass").value;
    if (!password) return sendLink();
    authMsg("Signing in…");
    const { error } = await sb.auth.signInWithPassword({ email, password });
    authMsg(error ? (/invalid/i.test(error.message)
      ? "Wrong email or password. If you've never set a password, use the sign-in link below, then click \"Set password\"."
      : "Couldn't sign in: " + error.message) : "");
  });
  async function sendLink() {
    const email = $("#authEmail").value.trim();
    if (!email) return authMsg("Enter your email first.");
    authMsg("Sending…");
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: location.href.split("#")[0] },
    });
    authMsg(error
      ? (/signups not allowed|not found/i.test(error.message)
          ? "That email hasn't been invited yet. Ask the tracker owner to invite you."
          : /rate limit/i.test(error.message)
            ? "Too many sign-in emails were sent recently (Supabase's free email limit). Use your password, or try again in an hour."
            : "Couldn't send link: " + error.message)
      : "Check your inbox for the sign-in link. Once you're in, click \"Set password\" so you won't need emails again.");
  }
  $("#authLink").addEventListener("click", sendLink);
  $("#passBtn").addEventListener("click", async () => {
    const p1 = prompt("Choose a password (at least 8 characters):");
    if (p1 == null) return;
    if (p1.length < 8) return toast("Password must be at least 8 characters.", 4000);
    if (prompt("Type it again to confirm:") !== p1) return toast("Passwords didn't match.", 4000);
    const { error } = await sb.auth.updateUser({ password: p1 });
    toast(error ? "Couldn't set password: " + error.message : "Password set. Next time, sign in with email + password.", 5000);
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
    if (payload.start_date && payload.expected_date && payload.start_date > payload.expected_date)
      return toast("Expected start must be on or before the expected completion date.", 4000);
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
    for (const k of ["title", "description", "requested_by", "assigned_to", "status", "start_date", "expected_date"])
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
    expanded.delete(id);
    if (editingId === id) resetForm();
    render();
  }

  /* ---------- Task details (expanded row) ---------- */
  function timing(r) {
    const t = todayISO();
    if (r.status === "Complete") return r.expected_date ? `Completed (target was ${fmtDate(r.expected_date)})` : "Completed";
    if (r.expected_date) {
      const d = daysBetween(t, r.expected_date);
      if (d < 0) return `<span class="overdue">Overdue by ${-d} day${d === -1 ? "" : "s"}</span>`;
      if (d === 0) return `<span class="overdue">Due today</span>`;
      return `Due in ${d} day${d === 1 ? "" : "s"}`;
    }
    if (r.start_date) {
      const d = daysBetween(t, r.start_date);
      return d > 0 ? `Starts in ${d} day${d === 1 ? "" : "s"}` : "Started, no completion date";
    }
    return "No dates set";
  }
  function detailRow(r) {
    const dur = r.start_date && r.expected_date ? `${daysBetween(r.start_date, r.expected_date) + 1} days` : "—";
    const item = (k, v) => `<div><dt>${k}</dt><dd>${v}</dd></div>`;
    return `<tr class="detail-row"><td colspan="7"><div class="detail">
      <div class="detail-desc"><dt>Description</dt><dd>${r.description ? esc(r.description) : '<span class="muted">No description</span>'}</dd></div>
      <dl class="detail-grid">
        ${item("Status", `<span class="pill" style="--c:${STATUS_COLOR[r.status]}">${r.status}</span>`)}
        ${item("Timing", timing(r))}
        ${item("Requested by", esc(r.requested_by) || "—")}
        ${item("Assigned developer", esc(r.assigned_to) || "Unassigned")}
        ${item("Expected start", fmtDate(r.start_date))}
        ${item("Expected completion", fmtDate(r.expected_date))}
        ${item("Planned duration", dur)}
        ${item("Logged", fmtDateTime(r.created_at))}
        ${item("Last updated", fmtDateTime(r.updated_at) + (r.updated_by ? ` by ${esc(r.updated_by)}` : ""))}
      </dl>
      <div class="row-gap"><button class="btn small" data-edit="${r.id}">Edit</button>
        <button class="btn small danger" data-del="${r.id}">Delete</button>
        <button class="btn small ghost" data-expand="${r.id}">Collapse</button></div>
    </div></td></tr>`;
  }
  // Open a task from anywhere (e.g. the Overview tab): switch to the list and expand it.
  function openTask(id) {
    if (!rows.some((r) => r.id === id)) return;
    expanded.add(id);
    if (!filtered().some((r) => r.id === id)) { $("#search").value = ""; $("#filterStatus").value = ""; $("#filterDev").value = ""; }
    setView("list"); render();
    const tr = document.querySelector(`tr[data-row="${id}"]`);
    if (tr) { tr.scrollIntoView({ behavior: "smooth", block: "center" }); tr.classList.add("flash"); setTimeout(() => tr.classList.remove("flash"), 1500); }
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
    const od = $("#ovDev"), ocur = od.value;
    od.innerHTML = `<option value="">All developers</option>` + devs.map((d) => `<option>${esc(d)}</option>`).join("");
    od.value = devs.includes(ocur) ? ocur : "";

    // table
    const today = todayISO();
    const list = sorted(filtered());
    $("#reqTable tbody").innerHTML = list.map((r) => {
      const overdue = r.expected_date && r.expected_date < today && r.status !== "Complete";
      const open = expanded.has(r.id);
      return `<tr class="${open ? "is-open" : ""}" data-row="${r.id}">
        <td><button class="title-btn" data-expand="${r.id}" aria-expanded="${open}"><span class="chev">${open ? "▾" : "▸"}</span>${esc(r.title)}</button>
          ${r.description && !open ? `<div class="desc clamp">${esc(r.description)}</div>` : ""}</td>
        <td>${esc(r.requested_by) || '<span class="muted">—</span>'}</td>
        <td>${esc(r.assigned_to) || '<span class="muted">Unassigned</span>'}</td>
        <td><select class="status-select" data-id="${r.id}" style="--c:${STATUS_COLOR[r.status]}">
          ${STATUSES.map((s) => `<option${s === r.status ? " selected" : ""}>${s}</option>`).join("")}
        </select></td>
        <td>${fmtDate(r.start_date)}</td>
        <td class="${overdue ? "overdue" : ""}" title="${overdue ? "Overdue" : ""}">${fmtDate(r.expected_date)}</td>
        <td class="actions">
          <button class="btn small" data-edit="${r.id}">Edit</button>
          <button class="btn small danger" data-del="${r.id}">Delete</button>
        </td></tr>${open ? detailRow(r) : ""}`;
    }).join("");
    $("#emptyMsg").hidden = list.length > 0;
    $("#emptyMsg").textContent = rows.length ? "No requests match these filters." : "No requests yet. Add the first one above.";
    document.querySelectorAll("th[data-sort]").forEach((th) => {
      th.classList.toggle("sorted", th.dataset.sort === sort.key);
      th.classList.toggle("desc", th.dataset.sort === sort.key && sort.desc);
    });
    renderOverview();
  }

  $("#reqTable").addEventListener("click", (e) => {
    const t = e.target.closest("[data-expand],[data-edit],[data-del],[data-sort]") || e.target;
    if (t.dataset.expand) {
      const id = t.dataset.expand;
      expanded.has(id) ? expanded.delete(id) : expanded.add(id);
      return render();
    }
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
  function header(title, n, verb = "exported") {
    return `<h3>${esc(cfg.appName || "Feature Tracker")} — ${title}</h3>
      <div class="sub">${n} request${n === 1 ? "" : "s"} · ${verb} ${fmtDate(todayISO())}</div>`;
  }
  const byDate = (k) => (a, b) => (a[k] || "9999") < (b[k] || "9999") ? -1 : (a[k] || "9999") > (b[k] || "9999") ? 1 : 0;
  const dateRange = (r) => r.start_date && r.expected_date ? `${fmtDate(r.start_date)} → ${fmtDate(r.expected_date)}`
    : r.expected_date ? `Due ${fmtDate(r.expected_date)}` : r.start_date ? `Starts ${fmtDate(r.start_date)}` : "No dates";

  function timelineHTML(list, title = "Timeline", verb = "exported") {
    const DAY = 86400000;
    const ts = (d) => new Date(d + "T00:00:00").getTime();
    list = [...list].sort((a, b) => byDate("start_date")(a, b) || byDate("expected_date")(a, b));
    // a bar runs from the expected start (or the day it was logged) to the expected completion
    const barStart = (r) => ts(r.start_date || (r.created_at || todayISO()).slice(0, 10));
    const barEnd = (r) => r.expected_date ? ts(r.expected_date) : null;
    const dated = list.filter((r) => r.expected_date || r.start_date);
    const now = ts(todayISO());

    let min = Math.min(now, ...dated.map((r) => Math.min(barStart(r), barEnd(r) ?? Infinity)));
    let max = Math.max(now + 14 * DAY, ...dated.map((r) => Math.max(barEnd(r) ?? 0, barStart(r) + 7 * DAY)));
    const m0 = new Date(min); min = new Date(m0.getFullYear(), m0.getMonth(), 1).getTime();
    const m1 = new Date(max); max = new Date(m1.getFullYear(), m1.getMonth() + 1, 1).getTime();
    const pct = (t) => ((t - min) / (max - min)) * 100;

    const ticks = [];
    for (let d = new Date(min); d.getTime() < max; d.setMonth(d.getMonth() + 1))
      ticks.push({ left: pct(d.getTime()), label: d.toLocaleDateString(undefined, { month: "short", year: "numeric" }) });
    const grid = ticks.map((t) => `<div class="grid-line" style="left:${t.left}%"></div>`).join("");
    const todayLine = `<div class="today" style="left:${pct(now)}%"></div>`;

    const body = list.map((r) => {
      const lbl = `<div class="lbl"><b title="${esc(r.title)}" data-open="${r.id}">${esc(r.title)}</b>
        <small>${esc(r.assigned_to || "Unassigned")} · ${r.status}</small></div>`;
      if (!r.expected_date && !r.start_date) return lbl + `<div class="track">${grid}${todayLine}<div class="nodate">No dates set</div></div>`;
      const s = barStart(r), e = barEnd(r);
      const open = e === null;                       // start known, no end yet
      const s2 = open ? s : Math.min(s, e), e2 = open ? s + 7 * DAY : e + DAY;
      const left = pct(s2), width = Math.max(pct(e2) - left, 0.6);
      const late = r.expected_date && r.expected_date < todayISO() && r.status !== "Complete";
      const est = r.start_date ? "" : " est";       // no explicit start: lighter bar
      return lbl + `<div class="track">${grid}${todayLine}
        <div class="bar${open ? " open" : ""}${est}${late ? " late" : ""}" data-open="${r.id}" style="left:${left}%;width:${width}%;--c:${STATUS_COLOR[r.status]}"
          title="${esc(dateRange(r))}">${esc(dateRange(r))}</div></div>`;
    }).join("");

    return `<div class="sheet">${header(title, list.length, verb)}${legend().replace("</div>",
        `<span><i style="--c:#c92a2a;width:3px"></i>Today</span><span><i style="--c:#adb5bd;opacity:.55"></i>No start date (from date logged)</span></div>`)}
      <div class="gantt">
        <div class="lbl"></div>
        <div class="axis">${ticks.map((t) => `<div class="tick" style="left:${t.left}%">${t.label}</div>`).join("")}</div>
        ${body || `<div></div><div class="nodate">No requests to show.</div>`}
      </div></div>`;
  }

  function boardHTML(list, title = "Status board", verb = "exported", statuses = STATUSES) {
    const cols = statuses.map((s) => {
      const items = list.filter((r) => r.status === s).sort(byDate("expected_date"));
      return `<div class="col" style="--c:${STATUS_COLOR[s]}">
        <h4><span>${s}</span><span>${items.length}</span></h4>
        ${items.map((r) => `<div class="tile" data-open="${r.id}"><b>${esc(r.title)}</b>
          <div class="meta"><span>${esc(r.assigned_to || "Unassigned")}</span></div>
          <div class="meta"><span>${esc(dateRange(r))}</span></div>
          ${r.requested_by ? `<div class="meta"><span>Requested by ${esc(r.requested_by)}</span></div>` : ""}
        </div>`).join("") || `<div class="meta" style="color:#6b7280;font-size:12px">Nothing here</div>`}
      </div>`;
    }).join("");
    return `<div class="sheet">${header(title, list.filter((r) => statuses.includes(r.status)).length, verb)}
      <div class="board" style="grid-template-columns:repeat(${statuses.length},1fr)">${cols}</div></div>`;
  }

  /* ---------- Live overview tab ---------- */
  let view = "list", overviewMode = "timeline";
  function renderOverview() {
    if (view !== "overview") return;
    const withDone = $("#ovDone").checked;
    const dev = $("#ovDev").value;
    const list = rows.filter((r) => (withDone || r.status !== "Complete") && (!dev || r.assigned_to === dev));
    const statuses = withDone ? STATUSES : STATUSES.filter((s) => s !== "Complete");
    $("#overviewArea").innerHTML = overviewMode === "timeline"
      ? timelineHTML(list, withDone ? "All requests" : "Open requests", "live ·")
      : boardHTML(list, withDone ? "All requests" : "Open requests", "live ·", statuses);
    document.querySelectorAll(".ovtab").forEach((t) => t.classList.toggle("active", t.dataset.mode === overviewMode));
  }
  function setView(v) {
    view = v;
    $("#listView").hidden = v !== "list";
    $("#overviewView").hidden = v !== "overview";
    document.querySelectorAll(".navtab").forEach((t) => t.classList.toggle("active", t.dataset.view === v));
    try { localStorage.setItem("ft-view", v); } catch (_) {}
    renderOverview();
  }
  document.querySelectorAll(".navtab").forEach((t) => t.addEventListener("click", () => setView(t.dataset.view)));
  $("#overviewArea").addEventListener("click", (e) => {
    const t = e.target.closest("[data-open]");
    if (t) openTask(t.dataset.open);
  });
  document.querySelectorAll(".ovtab").forEach((t) => t.addEventListener("click", () => { overviewMode = t.dataset.mode; renderOverview(); }));
  ["#ovDone", "#ovDev"].forEach((s) => $(s).addEventListener("change", renderOverview));

  function renderExport() {
    $("#exportArea").innerHTML = exportView === "timeline" ? timelineHTML(filtered()) : boardHTML(filtered());
    document.querySelectorAll("#exportDlg .tab").forEach((t) => t.classList.toggle("active", t.dataset.view === exportView));
  }

  $("#exportBtn").addEventListener("click", () => { renderExport(); $("#exportDlg").showModal(); });
  $("#closeDlg").addEventListener("click", () => $("#exportDlg").close());
  document.querySelectorAll("#exportDlg .tab").forEach((t) =>
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

  /* ---------- Import-from-email wizard ---------- */
  const wiz = { items: [], queue: [], idx: 0, saved: 0, sender: "", source: "" };
  const wizSteps = ["#wizPaste", "#wizPick", "#wizReview", "#wizDone"];
  const wizShow = (id) => wizSteps.forEach((s) => ($(s).hidden = s !== id));
  const FIELDS = ["title", "description", "requested_by", "assigned_to", "status", "start_date", "expected_date"];

  $("#importBtn").addEventListener("click", () => {
    Object.assign(wiz, { items: [], queue: [], idx: 0, saved: 0, sender: "" });
    $("#wizText").value = ""; $("#wizPasteMsg").textContent = "";
    wizShow("#wizPaste"); $("#importDlg").showModal(); $("#wizText").focus();
  });
  $("#wizClose").addEventListener("click", () => {
    if (!$("#wizReview").hidden &&
        !confirm("Close the wizard? Requests you haven't saved yet will be lost.")) return;
    $("#importDlg").close();
  });
  $("#wizFinish").addEventListener("click", () => $("#importDlg").close());
  $("#wizBackPaste").addEventListener("click", () => wizShow("#wizPaste"));

  // Rule-based fallback, used when the AI function isn't set up or fails.
  function heuristicExtract(text) {
    const lines = text.replace(/\r/g, "").split("\n");
    const from = lines.map((l) => l.match(/^\s*from:\s*(.+)$/i)).find(Boolean);
    let sender = from ? from[1].replace(/<[^>]*>/g, "").replace(/["']/g, "").trim() : "";
    if (/@/.test(sender) && !/\s/.test(sender)) sender = sender.split("@")[0];
    const body = lines.filter((l) => !/^\s*(from|to|cc|bcc|subject|sent|date):/i.test(l) && !/^\s*>/.test(l));

    const bullet = /^\s*(?:[-*•–]|\d+[.)]|\(?[a-z]\))\s+(.+)$/i;
    let raw = body.map((l) => l.match(bullet)).filter(Boolean).map((m) => m[1].trim());
    if (!raw.length) {
      const ask = /\b(could (we|you)|can (we|you)|would (be great|love|like)|it would be|please|need|we want|wish|should|add|allow|support|ability to)\b/i;
      raw = body.join(" ").split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 15 && ask.test(s));
    }
    if (!raw.length) {
      // last resort: each paragraph that isn't a greeting or sign-off
      const skip = /^(hi|hello|hey|dear|thanks|thank you|cheers|best|regards|kind regards|sent from)\b/i;
      raw = body.join("\n").split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim())
        .filter((p) => p.length > 15 && !skip.test(p));
    }
    return {
      sender,
      requests: raw.map((r) => {
        const clean = r.replace(/^(could (we|you)|can (we|you)|please|it would be (great|nice) (if|to)|we('d| would) (love|like) (to|if))\s+/i, "");
        let title = clean.split(/[.:;!?]|\s[-–]\s/)[0].trim();
        if (title.split(/\s+/).length > 9) title = title.split(/\s+/).slice(0, 9).join(" ") + "…";
        title = title.charAt(0).toUpperCase() + title.slice(1);
        return { title, description: r, requested_by: sender, expected_date: "" };
      }),
    };
  }

  async function aiExtract(text) {
    const { data, error } = await sb.functions.invoke("extract-requests", { body: { text } });
    if (error) {
      let msg = error.message;
      try { const b = await error.context.json(); if (b?.error) msg = b.error; } catch (_) {}
      throw new Error(msg);
    }
    if (!data || !Array.isArray(data.requests)) throw new Error("Unexpected AI response");
    return data;
  }

  $("#wizFind").addEventListener("click", async () => {
    const text = $("#wizText").value.trim();
    if (!text) { $("#wizPasteMsg").textContent = "Paste an email first."; return; }
    wiz.source = text;
    const btn = $("#wizFind"); btn.disabled = true;
    $("#wizPasteMsg").textContent = "Reading the email…";
    let result, usedAI = true, aiErr = "";
    try { result = await aiExtract(text); }
    catch (e) { usedAI = false; aiErr = e.message; result = heuristicExtract(text); }
    btn.disabled = false; $("#wizPasteMsg").textContent = "";
    wiz.sender = result.sender || "";
    wiz.items = (result.requests || []).map((r) => ({
      title: r.title || "", description: r.description || "",
      requested_by: r.requested_by || wiz.sender,
      expected_date: /^\d{4}-\d{2}-\d{2}$/.test(r.expected_date || "") ? r.expected_date : "",
      start_date: /^\d{4}-\d{2}-\d{2}$/.test(r.start_date || "") ? r.start_date : "",
      quote: r.description || "", pick: true,
    }));
    const n = wiz.items.length;
    $("#wizPickMsg").innerHTML =
      (n ? `Found <b>${n}</b> request${n === 1 ? "" : "s"}${wiz.sender ? ` from <b>${esc(wiz.sender)}</b>` : ""}. Untick any you don't want, then review each one.`
         : "No requests found automatically. Add them manually below.") +
      (usedAI ? ` <span class="badge">AI</span>` : ` <span class="badge" title="${esc(aiErr)}">basic mode</span>`);
    renderWizList(); wizShow("#wizPick");
  });

  function renderWizList() {
    $("#wizList").innerHTML = wiz.items.map((it, i) => `<li>
      <input type="checkbox" data-i="${i}" ${it.pick ? "checked" : ""} id="wz${i}">
      <label for="wz${i}" style="color:inherit;font-size:inherit"><b>${esc(it.title || "(new request)")}</b>
        ${it.description && it.description !== it.title ? `<span class="desc">${esc(it.description)}</span>` : ""}</label></li>`).join("");
    $("#wizStartReview").disabled = !wiz.items.some((x) => x.pick);
  }
  $("#wizList").addEventListener("change", (e) => {
    if (e.target.dataset.i) { wiz.items[+e.target.dataset.i].pick = e.target.checked; renderWizList(); }
  });
  $("#wizAddItem").addEventListener("click", () => {
    wiz.items.push({ title: "", description: "", requested_by: wiz.sender, expected_date: "", quote: "", pick: true });
    renderWizList();
  });
  $("#wizStartReview").addEventListener("click", () => {
    wiz.queue = wiz.items.filter((x) => x.pick).map((x) => ({ ...x, status: "Request", assigned_to: "", done: false }));
    wiz.idx = 0; wiz.saved = 0; showReview();
  });

  function showReview() {
    if (wiz.idx >= wiz.queue.length) {
      const skipped = wiz.queue.length - wiz.saved;
      $("#wizDoneMsg").innerHTML = `Added <b>${wiz.saved}</b> new request${wiz.saved === 1 ? "" : "s"} to the tracker.` +
        (skipped ? ` Skipped ${skipped}.` : "");
      return wizShow("#wizDone");
    }
    const it = wiz.queue[wiz.idx], f = $("#wizForm");
    for (const k of FIELDS) f.elements[k].value = it[k] || (k === "status" ? "Request" : "");
    $("#wizCounter").textContent = `Request ${wiz.idx + 1} of ${wiz.queue.length}`;
    $("#wizBar").style.width = `${(wiz.idx / wiz.queue.length) * 100}%`;
    $("#wizSource").textContent = it.quote || wiz.source.slice(0, 1500);
    $("#wizPrev").disabled = wiz.idx === 0;
    $("#wizSave").textContent = it.done ? "Already saved, next" : "Save & next";
    wizShow("#wizReview"); f.elements[it.title ? "description" : "title"].focus();
  }
  function captureReview() {
    const f = $("#wizForm"), it = wiz.queue[wiz.idx];
    for (const k of FIELDS) it[k] = f.elements[k].value.trim();
    return it;
  }
  $("#wizPrev").addEventListener("click", () => { captureReview(); wiz.idx--; showReview(); });
  $("#wizSkip").addEventListener("click", () => { captureReview(); wiz.idx++; showReview(); });
  $("#wizForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const it = captureReview();
    if (it.done) { wiz.idx++; return showReview(); }
    if (it.start_date && it.expected_date && it.start_date > it.expected_date)
      return toast("Expected start must be on or before the expected completion date.", 4000);
    const payload = { updated_by: user?.email || null };
    for (const k of FIELDS) payload[k] = it[k] || null;
    payload.status = payload.status || "Request";
    const btn = $("#wizSave"); btn.disabled = true;
    const { data, error } = await sb.from("feature_requests").insert(payload).select().single();
    btn.disabled = false;
    if (error) return toast("Save failed: " + error.message, 5000);
    if (!rows.some((r) => r.id === data.id)) rows.push(data);
    it.done = true; wiz.saved++; wiz.idx++; render(); showReview();
  });

  /* ---------- Delete duplicates (asks one by one) ---------- */
  const RANK = { "Request": 0, "Accepted": 1, "In Development": 2, "Complete": 3 };
  const normTitle = (t) => (t || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const dup = { pairs: [], idx: 0, deleted: 0, removed: new Set() };

  function findDuplicates() {
    const groups = new Map();
    for (const r of rows) {
      const k = normTitle(r.title); if (!k) continue;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }
    const pairs = [];
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      // keep the most progressed one, then the oldest
      g.sort((a, b) => (RANK[b.status] - RANK[a.status]) || ((a.created_at || "") < (b.created_at || "") ? -1 : 1));
      for (const d of g.slice(1)) pairs.push({ keepId: g[0].id, dupId: d.id });
    }
    return pairs;
  }
  function dupCard(r, label) {
    const f = (k, v) => `<div><dt>${k}</dt><dd>${v}</dd></div>`;
    return `<div class="dup-card"><div class="dup-label">${label}</div><b>${esc(r.title)}</b>
      <dl class="detail-grid one">
        ${f("Status", `<span class="pill" style="--c:${STATUS_COLOR[r.status]}">${r.status}</span>`)}
        ${f("Description", esc(r.description) || "—")}
        ${f("Requested by", esc(r.requested_by) || "—")}
        ${f("Developer", esc(r.assigned_to) || "Unassigned")}
        ${f("Dates", esc(dateRange(r)))}
        ${f("Logged", fmtDateTime(r.created_at))}
      </dl></div>`;
  }
  function showDup() {
    // skip pairs where one side is already gone
    while (dup.idx < dup.pairs.length) {
      const p = dup.pairs[dup.idx];
      if (!dup.removed.has(p.keepId) && !dup.removed.has(p.dupId) && rows.some((r) => r.id === p.keepId) && rows.some((r) => r.id === p.dupId)) break;
      dup.idx++;
    }
    if (dup.idx >= dup.pairs.length) {
      $("#dupBody").innerHTML = `<p>${dup.deleted ? `Deleted <b>${dup.deleted}</b> duplicate${dup.deleted === 1 ? "" : "s"}.` : "Nothing was deleted."}</p>`;
      $("#dupActions").hidden = true; $("#dupDone").hidden = false;
      $("#dupCounter").textContent = "All done";
      return;
    }
    const p = dup.pairs[dup.idx];
    const keep = rows.find((r) => r.id === p.keepId), d = rows.find((r) => r.id === p.dupId);
    $("#dupCounter").textContent = `Duplicate ${dup.idx + 1} of ${dup.pairs.length}`;
    $("#dupBody").innerHTML = `<p class="muted">These two requests have the same name. Delete the one on the right?</p>
      <div class="dup-grid">${dupCard(keep, "Keep")}${dupCard(d, "Duplicate — delete?")}</div>`;
    $("#dupActions").hidden = false; $("#dupDone").hidden = true;
  }
  async function dupDelete(id) {
    const btns = document.querySelectorAll("#dupActions button"); btns.forEach((b) => (b.disabled = true));
    const { error } = await sb.from("feature_requests").delete().eq("id", id);
    btns.forEach((b) => (b.disabled = false));
    if (error) { toast("Delete failed: " + error.message, 5000); return false; }
    rows = rows.filter((x) => x.id !== id); expanded.delete(id); dup.removed.add(id); dup.deleted++;
    render(); return true;
  }
  $("#dupBtn").addEventListener("click", () => {
    const pairs = findDuplicates();
    if (!pairs.length) return toast("No duplicate names found.");
    Object.assign(dup, { pairs, idx: 0, deleted: 0, removed: new Set() });
    showDup(); $("#dupDlg").showModal();
  });
  $("#dupDelete").addEventListener("click", async () => {
    if (await dupDelete(dup.pairs[dup.idx].dupId)) { dup.idx++; showDup(); }
  });
  $("#dupSwap").addEventListener("click", async () => {
    const p = dup.pairs[dup.idx];
    if (!(await dupDelete(p.keepId))) return;
    // the survivor becomes the one to keep for the rest of this group
    for (const q of dup.pairs.slice(dup.idx + 1)) if (q.keepId === p.keepId) q.keepId = p.dupId;
    dup.idx++; showDup();
  });
  $("#dupKeep").addEventListener("click", () => { dup.idx++; showDup(); });
  $("#dupStop").addEventListener("click", () => $("#dupDlg").close());
  $("#dupClose").addEventListener("click", () => $("#dupDlg").close());

  initAuth();
})();
