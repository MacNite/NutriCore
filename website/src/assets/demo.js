/**
 * What the demo needs a script for.
 *
 * The page is complete before this file runs: every screen, every day, every
 * dialog and every food is already in the HTML, and with the script switched
 * off the noscript rules in the page shell simply stop hiding them. So this is
 * only ever switching, filtering and opening - never rendering.
 *
 * Where the application would save something, there is nothing to save. Those
 * controls are marked in the markup and answered with one line of text rather
 * than with silence.
 */
(function () {
  "use strict";

  var root = document.documentElement;
  var $ = function (selector, scope) { return (scope || document).querySelector(selector); };
  var $$ = function (selector, scope) { return Array.prototype.slice.call((scope || document).querySelectorAll(selector)); };

  /* --- Screens ---------------------------------------------------------- */

  var panels = $$("[data-screen-panel]");
  // Only the two navigations mark the current screen; the wordmark leads to
  // Today the way it does in the application, without claiming to be a tab.
  var screenLinks = $$(".nav a[data-screen], .bottom-nav a[data-screen]");

  function showScreen(id) {
    if (!panels.some(function (panel) { return panel.dataset.screenPanel === id; })) return;
    panels.forEach(function (panel) { panel.hidden = panel.dataset.screenPanel !== id; });
    screenLinks.forEach(function (link) {
      if (link.dataset.screen === id) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    // Only Today carries the floating action button in the application, and
    // only Today reserves the space under the last card for it.
    var fabStack = $(".fab-stack");
    if (fabStack) fabStack.hidden = id !== "today";
    var shell = $(".shell");
    if (shell) shell.classList.toggle("shell--with-fab", id === "today");
    if (location.hash !== "#" + id) history.replaceState(null, "", "#" + id);
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  document.addEventListener("click", function (event) {
    var link = event.target.closest("[data-screen], [data-goto]");
    if (!link) return;
    event.preventDefault();
    closeDialogs();
    showScreen(link.dataset.screen || link.dataset.goto);
  });

  if (location.hash) showScreen(location.hash.slice(1));
  window.addEventListener("hashchange", function () { showScreen(location.hash.slice(1)); });

  /* --- Theme ------------------------------------------------------------
     The application's three states: an explicit light or dark, or the
     operating system's answer. Stored under the key the product uses, so a
     visitor who later self-hosts arrives on the theme they chose here. */

  var themeButtons = $$("[data-theme-set]");

  function applyTheme(theme) {
    root.setAttribute("data-theme", theme);
    themeButtons.forEach(function (button) {
      var pressed = button.dataset.themeSet === theme;
      button.setAttribute("aria-pressed", String(pressed));
      button.style.background = pressed ? "var(--accent-soft)" : "";
      button.style.color = pressed ? "var(--accent-soft-text)" : "";
      button.style.fontWeight = pressed ? "650" : "";
    });
    try { localStorage.setItem("nutricore-theme", theme); } catch { /* Not persisted; still applied. */ }
  }

  themeButtons.forEach(function (button) {
    button.addEventListener("click", function () { applyTheme(button.dataset.themeSet); });
  });

  var storedTheme = "system";
  try { storedTheme = localStorage.getItem("nutricore-theme") || "system"; } catch { /* Private mode. */ }
  applyTheme(storedTheme);

  /* --- The day ----------------------------------------------------------
     Today's date navigation, over the two days the fixture holds. */

  var dayPanels = $$("[data-day]");
  var dayLabel = $("[data-day-label]");
  var dayIndex = 0;

  function showDay(next) {
    if (next < 0 || next >= dayPanels.length) return;
    dayIndex = next;
    dayPanels.forEach(function (panel, index) { panel.hidden = index !== dayIndex; });
    if (dayLabel) dayLabel.textContent = dayPanels[dayIndex].dataset.dayWeekday || dayLabel.textContent;
  }

  $$("[data-day-step]").forEach(function (button) {
    button.addEventListener("click", function () {
      // The fixture's days run newest first, so "previous day" moves forward
      // through the array and "next day" moves back, the way the dates read.
      var step = Number(button.dataset.dayStep) === -1 ? 1 : -1;
      var next = dayIndex + step;
      if (next < 0 || next >= dayPanels.length) {
        toast("The fixture holds two days. The real diary has every day you have logged.");
        return;
      }
      showDay(next);
    });
  });

  /* --- Dialogs ----------------------------------------------------------
     The application's meals, activities and full micronutrient table are
     native dialogs, so they are native dialogs here too. */

  function closeDialogs() {
    $$("dialog[open]").forEach(function (dialog) { dialog.close(); });
  }

  document.addEventListener("click", function (event) {
    var opener = event.target.closest("[data-dialog]");
    if (opener) {
      var dialog = document.getElementById(opener.dataset.dialog);
      if (dialog && !dialog.open) dialog.showModal();
      return;
    }
    if (event.target.closest("[data-dialog-close]")) {
      var open = event.target.closest("dialog");
      if (open) open.close();
    }
  });

  /* --- The search field inside a meal ------------------------------------ */

  $$("[data-meal-search]").forEach(function (input) {
    var panel = $("[data-meal-search-panel]", input.closest(".food-search-dropdown"));
    input.addEventListener("input", function () {
      if (panel) panel.hidden = input.value.trim().length === 0;
    });
    input.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && panel && !panel.hidden) {
        event.preventDefault();
        event.stopPropagation();
        panel.hidden = true;
      }
    });
  });

  /* --- The food search ---------------------------------------------------
     The real screen searches the local database first and asks a remote
     source only when told to. Here the local database is the fixture, and the
     filtering is the same list narrowing in place. */

  var searchInput = $("[data-food-search]");
  var foodRows = $$("[data-food]");
  var foodList = $("[data-food-list]");
  var foodEmpty = $("[data-food-empty]");
  var foodStatus = $("[data-food-status]");
  var recentHeading = $("[data-food-recent-heading]");

  if (searchInput) {
    searchInput.addEventListener("input", function () {
      var query = searchInput.value.trim().toLowerCase();
      var matches = 0;

      foodRows.forEach(function (row) {
        var hit = query.length === 0 ? row.dataset.recent === "1" : row.dataset.food.indexOf(query) !== -1;
        row.hidden = !hit;
        if (hit) matches += 1;
      });

      if (foodList) foodList.classList.toggle("recent-food-list", query.length === 0);
      if (recentHeading) recentHeading.hidden = query.length > 0;
      if (foodEmpty) foodEmpty.hidden = matches > 0;
      if (foodStatus) foodStatus.textContent = query.length === 0 ? "" : String(matches);
    });
  }

  // The rows the screen opens on are the recently used ones; the rest are in
  // the HTML already and appear as soon as something is typed.
  foodRows.forEach(function (row) { row.dataset.recent = row.hidden ? "0" : "1"; });

  /* --- Progress chart ---------------------------------------------------- */

  $$("[data-series]").forEach(function (chip) {
    chip.addEventListener("click", function () {
      var on = chip.getAttribute("aria-pressed") !== "true";
      chip.setAttribute("aria-pressed", String(on));
      var group = $('[data-series-mark="' + chip.dataset.series + '"]');
      if (group) group.style.display = on ? "" : "none";
    });
  });

  /* --- The floating action button ---------------------------------------- */

  var fabToggle = $("[data-fab-toggle]");
  var fabMenu = $("[data-fab-menu]");

  function setFab(open) {
    if (!fabToggle || !fabMenu) return;
    fabMenu.hidden = !open;
    fabToggle.setAttribute("aria-expanded", String(open));
    fabToggle.querySelector("span").textContent = open ? "×" : "＋";
  }

  if (fabToggle) {
    fabToggle.addEventListener("click", function () { setFab(fabMenu.hidden); });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") setFab(false);
    });
    document.addEventListener("pointerdown", function (event) {
      if (!event.target.closest(".fab-stack")) setFab(false);
    });
  }

  /* --- What a fixture cannot do ------------------------------------------ */

  var toastElement = $("[data-demo-toast]");
  var toastTimer = null;

  function toast(message) {
    if (!toastElement) return;
    if (message) toastElement.firstChild.textContent = message + " ";
    toastElement.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastElement.hidden = true; }, 3200);
  }

  document.addEventListener("click", function (event) {
    if (event.target.closest("[data-demo-inert]")) {
      setFab(false);
      toast("Static demo — nothing here is saved.");
    }
  });
})();
