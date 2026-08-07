import type { UiManifestModel, UiMode } from "./ui-model.ts";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildUiHtml(opts: {
  label: string;
  path: string;
  mode: UiMode;
  model: UiManifestModel;
  content: string;
}): string {
  const label = escapeHtml(opts.label);
  const path = escapeHtml(opts.path);
  const mode = opts.mode;
  const initial = JSON.stringify(opts.model).replace(/</g, "\\u003c");
  const rawContent = escapeHtml(opts.content);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ap ui — ${label}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@3.4.1/dist/css/bootstrap.min.css">
  <style>
    body { padding-top: 70px; padding-bottom: 40px; background: #f5f5f5; }
    .path { font-family: Menlo, Monaco, Consolas, monospace; font-size: 12px; color: #777; }
    .panel-heading .badge { margin-left: 6px; }
    .bundle-card { margin-bottom: 12px; }
    .bundle-card .panel-heading.bundle-toggle {
      cursor: pointer;
      user-select: none;
    }
    .bundle-card .panel-heading .chevron {
      margin-right: 6px;
      color: #31708f;
    }
    .bundle-card .bundle-collapse { display: none; }
    .bundle-card.open .bundle-collapse { display: block; }
    .bundle-card .panel-body { background: #fff; }
    .bundle-summary {
      color: #777;
      font-weight: normal;
      margin-left: 8px;
      font-size: 12px;
    }
    .add-grouping {
      background: #fff;
      border: 1px dashed #bbb;
      border-radius: 3px;
      padding: 12px;
      margin-bottom: 16px;
    }
    .add-grouping .form-inline .form-group { margin-right: 8px; }
    .var-row { border-top: 1px solid #eee; padding-top: 12px; margin-top: 12px; }
    .var-row:first-child { border-top: 0; padding-top: 0; margin-top: 0; }
    textarea.form-control.raw-toml {
      font-family: Menlo, Monaco, Consolas, "Courier New", monospace;
      font-size: 13px;
      min-height: 360px;
    }
    textarea.form-control.short { min-height: 64px; }
    .toolbar { margin-bottom: 16px; }
    .catalog-pill { margin: 0 6px 6px 0; }
    #status { margin-top: 12px; }
    .section-hint { color: #777; margin-bottom: 12px; }
    label.small-label { font-size: 12px; color: #666; font-weight: normal; }
    .value-group .form-control {
      font-family: Menlo, Monaco, Consolas, "Courier New", monospace;
      font-size: 13px;
    }
    .value-group .form-control.is-masked {
      color: #555;
      background: #f9f9f9;
      letter-spacing: 0.5px;
    }
    .value-group .btn-reveal {
      min-width: 42px;
    }
    .navbar-actions {
      margin-right: 0;
    }
    .navbar-actions .btn { margin-left: 6px; }
    #dirty-badge {
      display: none;
      margin-right: 8px;
      vertical-align: middle;
    }
    #dirty-badge.is-dirty { display: inline-block; }
    #status {
      margin-bottom: 12px;
      display: none;
    }
    #status.is-visible { display: block; }
  </style>
</head>
<body>
  <nav class="navbar navbar-inverse navbar-fixed-top">
    <div class="container">
      <div class="navbar-header">
        <a class="navbar-brand" href="/">ap ui</a>
      </div>
      <form class="navbar-form navbar-right navbar-actions" onsubmit="return false;">
        <span id="dirty-badge" class="label label-warning">Unsaved</span>
        <button type="button" class="btn btn-default btn-sm" id="discard" disabled>Discard</button>
        <button type="button" class="btn btn-primary btn-sm" id="save">
          <span class="glyphicon glyphicon-floppy-disk" aria-hidden="true"></span> Save
        </button>
      </form>
      <p class="navbar-text navbar-right path" style="margin-right:12px">${path}</p>
      <p class="navbar-text navbar-right" style="margin-right:8px">${label}</p>
    </div>
  </nav>

  <div class="container">
    <div id="status"></div>
    <div class="clearfix toolbar">
      <div class="btn-group" role="group">
        <button type="button" class="btn btn-default active" id="tab-form">Form</button>
        <button type="button" class="btn btn-default" id="tab-raw">Raw TOML</button>
      </div>
    </div>

    <div id="view-form">
      ${mode === "project" ? projectPanels() : globalPanels()}
    </div>

    <div id="view-raw" style="display:none">
      <div class="panel panel-default">
        <div class="panel-heading"><strong>Raw TOML</strong></div>
        <div class="panel-body">
          <textarea class="form-control raw-toml" id="raw-content" spellcheck="false">${rawContent}</textarea>
        </div>
      </div>
    </div>
  </div>

  <script>
    var MODE = ${JSON.stringify(mode)};
    var state = ${initial};
    var usingRaw = false;
    var openBundles = {}; // bundle name → expanded
    var dirty = false;
    var baselineModel = null;
    var baselineRaw = "";

    function el(id) { return document.getElementById(id); }
    function setStatus(kind, message) {
      var statusEl = el("status");
      if (!message) {
        statusEl.className = "";
        statusEl.classList.remove("is-visible");
        statusEl.textContent = "";
        return;
      }
      statusEl.className = "alert alert-" + kind + " is-visible";
      statusEl.textContent = message;
    }

    function clone(obj) {
      return JSON.parse(JSON.stringify(obj));
    }

    function setDirty(on) {
      dirty = !!on;
      var badge = el("dirty-badge");
      var discard = el("discard");
      if (badge) badge.classList.toggle("is-dirty", dirty);
      if (discard) discard.disabled = !dirty;
      document.title = (dirty ? "• " : "") + "ap ui — ${label}";
    }

    function rememberBaseline(model, raw) {
      baselineModel = clone(model);
      baselineRaw = raw || "";
      setDirty(false);
    }

    function bindDirtyTracking(root) {
      if (!root) return;
      Array.prototype.forEach.call(root.querySelectorAll("input, select, textarea"), function (node) {
        if (node.id === "new-group-name" || node.id === "custom-bundle") return;
        node.addEventListener("input", function () { setDirty(true); });
        node.addEventListener("change", function () { setDirty(true); });
      });
    }

    function esc(s) {
      return String(s == null ? "" : s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;")
        .replace(/\\n/g, "&#10;")
        .replace(/\\r/g, "&#13;");
    }

    function field(label, html) {
      return '<div class="form-group"><label class="small-label">' + label + '</label>' + html + '</div>';
    }

    function input(name, value, placeholder) {
      return '<input class="form-control input-sm" data-f="' + name + '" value="' + esc(value || "") + '"' +
        (placeholder ? ' placeholder="' + esc(placeholder) + '"' : "") + '>';
    }

    function select(name, value, options) {
      return '<select class="form-control input-sm" data-f="' + name + '">' +
        options.map(function (o) {
          return '<option value="' + o + '"' + (o === value ? " selected" : "") + ">" + o + "</option>";
        }).join("") +
      "</select>";
    }

    function textarea(name, value, cls) {
      return '<textarea class="form-control input-sm ' + (cls || "short") + '" data-f="' + name + '">' +
        esc(value || "") + "</textarea>";
    }

    function renderProjectBundles() {
      var catalog = state.catalog || [];
      var active = {};
      (state.activeBundles || []).forEach(function (b) { active[b] = true; });
      var names = catalog.slice();
      (state.activeBundles || []).forEach(function (b) {
        if (names.indexOf(b) < 0) names.push(b);
      });
      names.sort();

      var checks = names.map(function (name) {
        return '<label class="checkbox-inline catalog-pill">' +
          '<input type="checkbox" data-bundle="' + esc(name) + '"' +
          (active[name] ? " checked" : "") + "> " + esc(name) +
        "</label>";
      }).join("");

      el("project-bundles").innerHTML =
        '<p class="section-hint">Opt into catalog bundles for this repo.</p>' +
        '<div id="bundle-checks">' + checks + "</div>" +
        '<div class="form-inline" style="margin-top:12px">' +
          '<div class="form-group">' +
            '<input class="form-control input-sm" id="custom-bundle" placeholder="custom bundle name">' +
          "</div> " +
          '<button type="button" class="btn btn-default btn-sm" id="add-bundle">Add</button>' +
        "</div>";

      el("add-bundle").onclick = function () {
        var name = (el("custom-bundle").value || "").trim();
        if (!name) return;
        if ((state.activeBundles || []).indexOf(name) < 0) state.activeBundles.push(name);
        el("custom-bundle").value = "";
        renderAll();
        setDirty(true);
      };
      bindDirtyTracking(el("project-bundles"));
    }

    function maskSecret(value) {
      if (!value) return "";
      if (value.length <= 4) return "••••";
      return value.slice(0, 4) + "•".repeat(Math.min(8, value.length - 4));
    }

    function valueField(v) {
      var isSecret = (v.visibility || "secret") === "secret";
      var useVault = v.storage === "secrets.json";
      var real = v.value || "";
      if (!isSecret) {
        return field(
          "Value (optional)",
          input("value", real, "inline public value")
        );
      }

      if (MODE === "project" && useVault) {
        return field(
          "Storage",
          '<p class="form-control-static" style="margin:0"><code>secrets.json</code></p>'
        );
      }

      var shown = real ? maskSecret(real) : "";
      return field(
        "Secret value",
        '<div class="input-group value-group">' +
          '<input type="text" class="form-control input-sm is-masked" data-f="value" data-secret="1" data-revealed="0" data-real="' + esc(real) + '" value="' + esc(shown) + '" placeholder="" autocomplete="off" spellcheck="false">' +
          '<span class="input-group-btn">' +
            '<button type="button" class="btn btn-default btn-sm btn-reveal" title="Show / hide" aria-label="Show or hide secret">' +
              '<span class="glyphicon glyphicon-eye-open" aria-hidden="true"></span>' +
            "</button>" +
          "</span>" +
        "</div>"
      );
    }

    function bindValueControls(root) {
      Array.prototype.forEach.call(root.querySelectorAll(".var-row"), function (row) {
        var vis = row.querySelector('[data-f="visibility"]');
        if (vis) {
          vis.onchange = function () {
            readFormIntoState();
            renderAll();
          };
        }
        var storage = row.querySelector('[data-f="storage"]');
        if (storage) {
          storage.onchange = function () {
            readFormIntoState();
            renderAll();
          };
        }

        var inputEl = row.querySelector('[data-f="value"][data-secret="1"]');
        if (!inputEl) return;
        var btn = row.querySelector(".btn-reveal");
        var icon = btn && btn.querySelector(".glyphicon");

        function setRevealed(on) {
          var real = inputEl.getAttribute("data-real") || "";
          inputEl.setAttribute("data-revealed", on ? "1" : "0");
          if (on) {
            inputEl.value = real;
            inputEl.classList.remove("is-masked");
            inputEl.readOnly = false;
            if (icon) {
              icon.classList.remove("glyphicon-eye-open");
              icon.classList.add("glyphicon-eye-close");
            }
            if (btn) btn.title = "Hide";
          } else {
            inputEl.value = real ? maskSecret(real) : "";
            inputEl.classList.add("is-masked");
            inputEl.readOnly = true;
            if (icon) {
              icon.classList.remove("glyphicon-eye-close");
              icon.classList.add("glyphicon-eye-open");
            }
            if (btn) btn.title = "Show";
          }
        }

        // Empty secrets start editable so you can type; non-empty start masked.
        if (!inputEl.getAttribute("data-real")) {
          setRevealed(true);
        } else {
          setRevealed(false);
        }

        if (btn) {
          btn.onclick = function () {
            setRevealed(inputEl.getAttribute("data-revealed") !== "1");
          };
        }

        inputEl.oninput = function () {
          if (inputEl.getAttribute("data-revealed") === "1") {
            inputEl.setAttribute("data-real", inputEl.value);
          }
        };
      });
    }

    function renderVarEditor(v, idx, opts) {
      opts = opts || {};
      var storageSelect = MODE === "project"
        ? '<div class="col-sm-3">' + field("Storage", select("storage", v.storage || "", ["", "secrets.json"])) + "</div>"
        : "";
      var deriveCol = MODE === "project" ? "col-sm-2" : "col-sm-3";
      return '<div class="var-row" data-var-idx="' + idx + '">' +
        '<div class="row">' +
          '<div class="col-sm-3">' + field("Key", input("key", v.key, "MY_API_KEY")) + "</div>" +
          '<div class="col-sm-2">' + field("Visibility", select("visibility", v.visibility || "secret", ["secret", "public"])) + "</div>" +
          storageSelect +
          '<div class="' + deriveCol + '">' + field("Derive", select("derive", v.derive || "", ["", "public-ipv4"])) + "</div>" +
          '<div class="col-sm-2 text-right" style="padding-top:22px">' +
            '<button type="button" class="btn btn-danger btn-xs" data-remove-var="' + idx + '">Remove</button>' +
          "</div>" +
        "</div>" +
        '<div class="row">' +
          '<div class="col-sm-6">' + field("Ask", input("ask", v.ask, "How to get this key")) + "</div>" +
          '<div class="col-sm-6">' + field("Docs", input("docs", v.docs, "https://…")) + "</div>" +
        "</div>" +
        (opts.hideValue ? "" :
          '<div class="row"><div class="col-sm-12">' + valueField(v) + "</div></div>") +
      "</div>";
    }

    function collectVars(container) {
      var rows = container.querySelectorAll("[data-var-idx]");
      var out = [];
      rows.forEach(function (row) {
        var get = function (name) {
          var node = row.querySelector('[data-f="' + name + '"]');
          return node ? node.value : "";
        };
        var key = get("key").trim();
        if (!key) return;
        var valueNode = row.querySelector('[data-f="value"]');
        var value = "";
        if (valueNode) {
          if (valueNode.getAttribute("data-real") !== null) {
            value = valueNode.getAttribute("data-real") || "";
          } else {
            value = valueNode.value || "";
          }
        }
        var item = {
          key: key,
          visibility: get("visibility") || "secret",
          storage: get("storage") || undefined,
          ask: get("ask") || undefined,
          docs: get("docs") || undefined,
          value: value || undefined,
          derive: get("derive") || undefined
        };
        if (!item.ask) delete item.ask;
        if (!item.docs) delete item.docs;
        if (!item.value) delete item.value;
        if (!item.derive) delete item.derive;
        if (!item.storage) delete item.storage;
        if (item.storage === "secrets.json") delete item.value;
        out.push(item);
      });
      return out;
    }

    function renderProjectVars() {
      var html = '<p class="section-hint">Repo-specific vars (beyond catalog bundles).</p>';
      if (!state.vars.length) {
        html += '<p class="text-muted">No standalone vars yet.</p>';
      } else {
        html += state.vars.map(function (v, i) { return renderVarEditor(v, i); }).join("");
      }
      html += '<button type="button" class="btn btn-default btn-sm" id="add-var">Add var</button>';
      el("project-vars").innerHTML = html;
      el("add-var").onclick = function () {
        readFormIntoState();
        state.vars.push({ key: "", visibility: "secret" });
        renderAll();
        setDirty(true);
      };
      Array.prototype.forEach.call(el("project-vars").querySelectorAll("[data-remove-var]"), function (btn) {
        btn.onclick = function () {
          readFormIntoState();
          state.vars.splice(Number(btn.getAttribute("data-remove-var")), 1);
          renderAll();
          setDirty(true);
        };
      });
      bindValueControls(el("project-vars"));
    }

    function renderGlobalBundles() {
      var html = '<p class="section-hint">Each grouping is a <code>[bundle.*]</code> with its vars. Collapse to scan; expand to edit.</p>';

      html += '<div class="add-grouping">' +
        '<div class="form-inline" style="margin-bottom:8px">' +
          '<div class="form-group">' +
            '<input class="form-control input-sm" id="new-group-name" placeholder="grouping name (e.g. stripe)">' +
          "</div> " +
          '<button type="button" class="btn btn-primary btn-sm" id="add-empty-bundle">' +
            '<span class="glyphicon glyphicon-plus" aria-hidden="true"></span> Add grouping' +
          "</button>" +
        "</div>" +
        '<div>' +
          '<span class="text-muted" style="margin-right:6px">Or from catalog:</span>' +
          (state.catalog || []).map(function (name) {
            var exists = (state.bundles || []).some(function (b) { return b.name === name; });
            return '<button type="button" class="btn btn-default btn-xs catalog-pill" data-add-catalog="' +
              esc(name) + '"' + (exists ? " disabled" : "") + "> + " + esc(name) + "</button>";
          }).join("") +
        "</div>" +
      "</div>";

      if (!state.bundles.length) {
        html += '<p class="text-muted">No groupings yet — add one above.</p>';
      }

      state.bundles.forEach(function (b, bi) {
        var claimed = {};
        (b.vars || []).forEach(function (k) { claimed[k] = true; });
        var related = (state.vars || []).filter(function (v) { return claimed[v.key]; });
        var name = b.name || "(unnamed)";
        var isOpen = !!openBundles[name] || (!b.name && openBundles[""]);
        var summary = (b.vars || []).length
          ? (b.vars || []).length + " var" + ((b.vars || []).length === 1 ? "" : "s")
          : "no vars";

        html += '<div class="panel panel-info bundle-card' + (isOpen ? " open" : "") + '" data-bundle-idx="' + bi + '" data-bundle-name="' + esc(name) + '">' +
          '<div class="panel-heading bundle-toggle">' +
            '<span class="glyphicon chevron ' + (isOpen ? "glyphicon-chevron-down" : "glyphicon-chevron-right") + '" aria-hidden="true"></span>' +
            '<strong>bundle.' + esc(name) + '</strong>' +
            '<span class="bundle-summary">' + esc(summary) +
              (b.ask ? " · " + esc(b.ask.length > 48 ? b.ask.slice(0, 48) + "…" : b.ask) : "") +
            "</span>" +
            '<button type="button" class="btn btn-danger btn-xs pull-right" data-remove-bundle="' + bi + '">Remove</button>' +
          "</div>" +
          '<div class="bundle-collapse">' +
            '<div class="panel-body">' +
              '<div class="bundle-fields">' +
                '<div class="row">' +
                  '<div class="col-sm-4">' + field("Name", input("name", b.name, "cloudflare")) + "</div>" +
                  '<div class="col-sm-8">' + field("Docs", input("docs", b.docs, "https://…")) + "</div>" +
                "</div>" +
                field("Ask", input("ask", b.ask)) +
                field("Prompt", textarea("prompt", b.prompt)) +
                field("Vars (comma-separated keys)", input("vars", (b.vars || []).join(", "), "KEY_A, KEY_B")) +
              "</div>" +
              '<hr><strong>Var definitions</strong>' +
              related.map(function (v) {
                var idx = state.vars.indexOf(v);
                return renderVarEditor(v, idx);
              }).join("") +
              (related.length ? "" : '<p class="text-muted">No var blocks for these keys yet.</p>') +
              '<button type="button" class="btn btn-default btn-xs" data-add-bundle-var="' + bi + '">Add var for this bundle</button>' +
            "</div>" +
          "</div>" +
        "</div>";
      });

      el("global-bundles").innerHTML = html;

      Array.prototype.forEach.call(document.querySelectorAll(".bundle-toggle"), function (heading) {
        heading.onclick = function (e) {
          if (e.target.closest && e.target.closest("[data-remove-bundle]")) return;
          if (e.target.getAttribute && e.target.getAttribute("data-remove-bundle") !== null) return;
          if (e.target.parentElement && e.target.parentElement.getAttribute("data-remove-bundle") !== null) return;
          var card = heading.closest ? heading.closest(".bundle-card") : heading.parentElement;
          if (!card) return;
          var name = card.getAttribute("data-bundle-name") || "";
          var nowOpen = !card.classList.contains("open");
          if (nowOpen) openBundles[name] = true;
          else delete openBundles[name];
          card.classList.toggle("open", nowOpen);
          var chev = heading.querySelector(".chevron");
          if (chev) {
            chev.classList.toggle("glyphicon-chevron-right", !nowOpen);
            chev.classList.toggle("glyphicon-chevron-down", nowOpen);
          }
        };
      });

      Array.prototype.forEach.call(document.querySelectorAll("[data-add-catalog]"), function (btn) {
        btn.onclick = function () {
          readFormIntoState();
          addCatalogBundle(btn.getAttribute("data-add-catalog"));
        };
      });
      var blank = el("add-empty-bundle");
      if (blank) blank.onclick = function () {
        readFormIntoState();
        var name = ((el("new-group-name") && el("new-group-name").value) || "").trim();
        if (!name) {
          setStatus("warning", "Enter a grouping name first.");
          if (el("new-group-name")) el("new-group-name").focus();
          return;
        }
        if (state.bundles.some(function (b) { return b.name === name; })) {
          setStatus("warning", 'Grouping "' + name + '" already exists.');
          openBundles[name] = true;
          renderAll();
          return;
        }
        state.bundles.push({ name: name, ask: "", docs: "", prompt: "", vars: [] });
        openBundles[name] = true;
        if (el("new-group-name")) el("new-group-name").value = "";
        renderAll();
        setDirty(true);
        setStatus("info", "Added grouping " + name);
      };
      if (el("new-group-name")) {
        el("new-group-name").onkeydown = function (e) {
          if (e.key === "Enter") {
            e.preventDefault();
            blank.click();
          }
        };
      }
      Array.prototype.forEach.call(document.querySelectorAll("[data-remove-bundle]"), function (btn) {
        btn.onclick = function (e) {
          e.stopPropagation();
          readFormIntoState();
          var bi = Number(btn.getAttribute("data-remove-bundle"));
          var bundle = state.bundles[bi];
          var keys = {};
          (bundle.vars || []).forEach(function (k) { keys[k] = true; });
          delete openBundles[bundle.name || "(unnamed)"];
          state.bundles.splice(bi, 1);
          state.vars = state.vars.filter(function (v) { return !keys[v.key]; });
          renderAll();
          setDirty(true);
        };
      });
      Array.prototype.forEach.call(document.querySelectorAll("[data-add-bundle-var]"), function (btn) {
        btn.onclick = function () {
          readFormIntoState();
          var bi = Number(btn.getAttribute("data-add-bundle-var"));
          var key = "NEW_KEY";
          var n = 1;
          while (state.vars.some(function (v) { return v.key === key; })) {
            key = "NEW_KEY_" + (++n);
          }
          state.bundles[bi].vars = state.bundles[bi].vars || [];
          state.bundles[bi].vars.push(key);
          state.vars.push({ key: key, visibility: "secret" });
          openBundles[state.bundles[bi].name || "(unnamed)"] = true;
          renderAll();
          setDirty(true);
        };
      });
      Array.prototype.forEach.call(document.querySelectorAll("[data-remove-var]"), function (btn) {
        btn.onclick = function () {
          readFormIntoState();
          var idx = Number(btn.getAttribute("data-remove-var"));
          var key = state.vars[idx] && state.vars[idx].key;
          state.vars.splice(idx, 1);
          state.bundles.forEach(function (b) {
            b.vars = (b.vars || []).filter(function (k) { return k !== key; });
          });
          renderAll();
          setDirty(true);
        };
      });
      bindValueControls(el("global-bundles"));
      bindDirtyTracking(el("global-bundles"));
    }

    function renderGlobalOrphans() {
      var root = el("global-orphans");
      if (!root) return;

      var claimed = {};
      (state.bundles || []).forEach(function (b) {
        (b.vars || []).forEach(function (k) { claimed[k] = true; });
      });
      var orphans = [];
      (state.vars || []).forEach(function (v, i) {
        if (v.key && !claimed[v.key]) orphans.push({ v: v, i: i });
      });

      var html = '<p class="section-hint">Vars not attached to any grouping. Your file currently has ' +
        orphans.length + ' ungrouped var' + (orphans.length === 1 ? "" : "s") + '.</p>';

      if (!orphans.length) {
        html += '<p class="text-muted">None.</p>';
      } else {
        orphans.forEach(function (o) {
          var name = o.v.key || "(unnamed)";
          var isOpen = !!openBundles["var:" + name];
          html += '<div class="panel panel-default bundle-card' + (isOpen ? " open" : "") + '" data-orphan-key="' + esc(name) + '">' +
            '<div class="panel-heading bundle-toggle">' +
              '<span class="glyphicon chevron ' + (isOpen ? "glyphicon-chevron-down" : "glyphicon-chevron-right") + '" aria-hidden="true"></span>' +
              '<strong>' + esc(name) + '</strong>' +
              '<span class="bundle-summary">' + esc(o.v.visibility || "secret") +
                (o.v.ask ? " · " + esc(o.v.ask.length > 40 ? o.v.ask.slice(0, 40) + "…" : o.v.ask) : "") +
              "</span>" +
              '<button type="button" class="btn btn-danger btn-xs pull-right" data-remove-var="' + o.i + '">Remove</button>' +
            "</div>" +
            '<div class="bundle-collapse"><div class="panel-body">' +
              renderVarEditor(o.v, o.i) +
            "</div></div>" +
          "</div>";
        });
      }

      html += '<button type="button" class="btn btn-default btn-sm" id="add-orphan" style="margin-top:8px">Add var</button>';
      root.innerHTML = html;

      Array.prototype.forEach.call(root.querySelectorAll(".bundle-toggle"), function (heading) {
        heading.onclick = function (e) {
          if (e.target.closest && e.target.closest("[data-remove-var]")) return;
          var card = heading.parentElement;
          if (!card) return;
          var key = card.getAttribute("data-orphan-key") || "";
          var nowOpen = !card.classList.contains("open");
          if (nowOpen) openBundles["var:" + key] = true;
          else delete openBundles["var:" + key];
          card.classList.toggle("open", nowOpen);
          var chev = heading.querySelector(".chevron");
          if (chev) {
            chev.classList.toggle("glyphicon-chevron-right", !nowOpen);
            chev.classList.toggle("glyphicon-chevron-down", nowOpen);
          }
        };
      });

      var addBtn = el("add-orphan");
      if (addBtn) addBtn.onclick = function () {
        readFormIntoState();
        state.vars.push({ key: "NEW_KEY", visibility: "secret" });
        openBundles["var:NEW_KEY"] = true;
        renderAll();
        setDirty(true);
      };

      Array.prototype.forEach.call(root.querySelectorAll("[data-remove-var]"), function (btn) {
        btn.onclick = function (e) {
          e.stopPropagation();
          readFormIntoState();
          var idx = Number(btn.getAttribute("data-remove-var"));
          var key = state.vars[idx] && state.vars[idx].key;
          state.vars.splice(idx, 1);
          if (key) delete openBundles["var:" + key];
          renderAll();
          setDirty(true);
        };
      });

      bindValueControls(root);
      bindDirtyTracking(root);
    }

    function addCatalogBundle(name) {
      if (state.bundles.some(function (b) { return b.name === name; })) {
        openBundles[name] = true;
        renderAll();
        return;
      }
      fetch("/api/catalog/" + encodeURIComponent(name))
        .then(function (r) { return r.json(); })
        .then(function (body) {
          if (body.error) {
            setStatus("danger", body.error);
            return;
          }
          state.bundles.push(body.bundle);
          (body.vars || []).forEach(function (v) {
            if (!state.vars.some(function (x) { return x.key === v.key; })) state.vars.push(v);
          });
          openBundles[name] = true;
          renderAll();
          setDirty(true);
          setStatus("info", "Added catalog grouping " + name);
        })
        .catch(function (err) { setStatus("danger", String(err)); });
    }

    function readFormIntoState() {
      if (MODE === "project") {
        var checks = document.querySelectorAll("#bundle-checks input[type=checkbox]");
        state.activeBundles = [];
        Array.prototype.forEach.call(checks, function (c) {
          if (c.checked) state.activeBundles.push(c.getAttribute("data-bundle"));
        });
        var varsRoot = el("project-vars");
        if (varsRoot) state.vars = collectVars(varsRoot);
        return;
      }

      // Preserve which groupings were expanded across re-render (incl. renames).
      var nextOpen = {};
      Array.prototype.forEach.call(document.querySelectorAll(".bundle-card"), function (card) {
        if (!card.classList.contains("open")) return;
        var fields = card.querySelector(".bundle-fields");
        var nameNode = fields && fields.querySelector('[data-f="name"]');
        var name = (nameNode && nameNode.value.trim()) || card.getAttribute("data-bundle-name") || "";
        if (name) nextOpen[name] = true;
      });
      openBundles = nextOpen;

      var bundles = [];
      Array.prototype.forEach.call(document.querySelectorAll("[data-bundle-idx]"), function (panel) {
        var fields = panel.querySelector(".bundle-fields");
        var get = function (name) {
          var node = fields.querySelector('[data-f="' + name + '"]');
          return node ? node.value : "";
        };
        var varsRaw = get("vars");
        var ask = get("ask");
        var docs = get("docs");
        var prompt = get("prompt");
        bundles.push({
          name: get("name").trim(),
          ask: ask || undefined,
          docs: docs || undefined,
          prompt: prompt || undefined,
          vars: varsRaw.split(",").map(function (s) { return s.trim(); }).filter(Boolean)
        });
      });
      state.bundles = bundles;

      // Collect rendered var editors; preserve unattached (orphan) vars in state.
      var claimed = {};
      bundles.forEach(function (b) {
        (b.vars || []).forEach(function (k) { claimed[k] = true; });
      });
      var byKey = {};
      (state.vars || []).forEach(function (v) {
        if (v.key && !claimed[v.key]) byKey[v.key] = v;
      });
      collectVars(document.body).forEach(function (v) { byKey[v.key] = v; });
      state.vars = Object.keys(byKey).sort().map(function (k) { return byKey[k]; });
    }

    function renderAll() {
      if (MODE === "project") {
        renderProjectBundles();
        renderProjectVars();
        bindDirtyTracking(el("project-bundles"));
        bindDirtyTracking(el("project-vars"));
      } else {
        renderGlobalBundles();
        renderGlobalOrphans();
      }
    }

    function showForm() {
      usingRaw = false;
      el("view-form").style.display = "";
      el("view-raw").style.display = "none";
      el("tab-form").classList.add("active");
      el("tab-raw").classList.remove("active");
    }

    function showRaw() {
      if (!usingRaw) {
        readFormIntoState();
        // preview serialized via server
        fetch("/api/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: state })
        })
          .then(function (r) { return r.json(); })
          .then(function (body) {
            if (body.content) el("raw-content").value = body.content;
            else if (body.error) setStatus("danger", body.error);
          })
          .catch(function () { /* keep previous raw */ });
      }
      usingRaw = true;
      el("view-form").style.display = "none";
      el("view-raw").style.display = "";
      el("tab-form").classList.remove("active");
      el("tab-raw").classList.add("active");
    }

    el("tab-form").onclick = showForm;
    el("tab-raw").onclick = showRaw;

    el("raw-content").addEventListener("input", function () { setDirty(true); });

    el("save").onclick = function () {
      setStatus("info", "Saving…");
      var payload;
      if (usingRaw) {
        payload = { content: el("raw-content").value };
      } else {
        readFormIntoState();
        payload = { model: state };
      }
      fetch("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })
        .then(function (res) { return res.json().then(function (body) { return { ok: res.ok, body: body }; }); })
        .then(function (result) {
          if (!result.ok) {
            setStatus("danger", result.body.error || "Save failed.");
            return;
          }
          if (result.body.model) state = result.body.model;
          if (result.body.content) el("raw-content").value = result.body.content;
          if (!usingRaw) renderAll();
          rememberBaseline(state, el("raw-content").value);
          setStatus("success", result.body.message || "Saved.");
        })
        .catch(function (err) { setStatus("danger", String(err)); });
    };

    el("discard").onclick = function () {
      if (!dirty) return;
      state = clone(baselineModel);
      el("raw-content").value = baselineRaw;
      if (!usingRaw) renderAll();
      setDirty(false);
      setStatus("success", "Discarded unsaved changes.");
    };

    rememberBaseline(state, el("raw-content").value);
    renderAll();
  </script>
</body>
</html>
`;
}

function projectPanels(): string {
  return `
    <div class="panel panel-primary">
      <div class="panel-heading"><strong>Active bundles</strong></div>
      <div class="panel-body" id="project-bundles"></div>
    </div>
    <div class="panel panel-default">
      <div class="panel-heading"><strong>Standalone vars</strong></div>
      <div class="panel-body" id="project-vars"></div>
    </div>
  `;
}

function globalPanels(): string {
  return `
    <div class="panel panel-primary">
      <div class="panel-heading"><strong>Groupings</strong> <span class="badge">bundles</span></div>
      <div class="panel-body" id="global-bundles"></div>
    </div>
    <div class="panel panel-default">
      <div class="panel-heading"><strong>Ungrouped vars</strong></div>
      <div class="panel-body" id="global-orphans"></div>
    </div>
  `;
}
